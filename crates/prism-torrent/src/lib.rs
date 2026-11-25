//! BitTorrent and magnet-link downloads for HDM.
//!
//! Uses the bundled high-speed C++ `aria2c` engine (MSE/PE encryption, pure TCP pipelining,
//! 256 peers, 64 MiB disk cache, outbound-only safe mode) when available, with automatic
//! fallback to `librqbit` (also used for offline unit tests).

mod aria2;

use anyhow::{Context, Result};
use librqbit::api::TorrentIdOrHash;
use librqbit::limits::LimitsConfig;
use librqbit::{
    AddTorrent, AddTorrentOptions, AddTorrentResponse, ByteBufOwned, ConnectionOptions,
    ManagedTorrent, PeerConnectionOptions, Session, SessionOptions, SessionPersistenceConfig,
    TorrentStatsState, ValidatedTorrentMetaV1Info,
};
use std::collections::{HashMap, HashSet};
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

type ManagedTorrentHandle = Arc<ManagedTorrent>;
use serde::{Deserialize, Serialize};

fn default_trackers() -> HashSet<url::Url> {
    aria2::TOP_PUBLIC_TRACKERS
        .iter()
        .filter_map(|u| url::Url::parse(u).ok())
        .collect()
}

/// Where a torrent comes from.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum TorrentSource {
    /// `magnet:?xt=...` link or an `http(s)://.../x.torrent` URL.
    Url(String),
    /// Raw `.torrent` file contents.
    #[serde(with = "serde_bytes_b64")]
    File(Vec<u8>),
}

impl TorrentSource {
    fn to_add(&self) -> AddTorrent<'static> {
        match self {
            TorrentSource::Url(u) => AddTorrent::from_url(u.clone()),
            TorrentSource::File(b) => AddTorrent::from_bytes(b.clone()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TorrentFile {
    pub index: usize,
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TorrentMeta {
    pub info_hash: String,
    pub name: String,
    pub total_size: u64,
    pub files: Vec<TorrentFile>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TorrentState {
    Initializing,
    Downloading,
    Seeding,
    Paused,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TorrentProgress {
    pub state: TorrentState,
    pub downloaded: u64,
    pub uploaded: u64,
    pub total: u64,
    /// Bytes per second.
    pub download_speed: u64,
    pub upload_speed: u64,
    pub peers: u32,
    pub eta_secs: Option<u64>,
    pub finished: bool,
    pub error: Option<String>,
    pub name: Option<String>,
}

enum Backend {
    Aria2(aria2::Aria2Backend),
    Librqbit {
        session: Arc<Session>,
        inspected: Mutex<HashMap<String, TorrentMeta>>,
    },
}

/// A running BitTorrent session.
pub struct TorrentEngine {
    backend: Backend,
}

impl TorrentEngine {
    /// Start the session. Prefers the bundled high-speed C++ `aria2c` engine (MSE/PE
    /// encryption, TCP, outbound-only) and falls back cleanly to `librqbit` (TCP-only,
    /// outbound-only) if `aria2c` is unavailable.
    pub async fn start(
        state_dir: &Path,
        default_output: PathBuf,
        keep: &(dyn Fn(&str) -> bool + Send + Sync),
    ) -> Result<Self> {
        std::fs::create_dir_all(state_dir).context("create torrent state dir")?;
        if let Some(bin) = aria2::find_aria2c() {
            match aria2::Aria2Backend::start(bin, state_dir, default_output.clone()).await {
                Ok(a) => {
                    return Ok(Self {
                        backend: Backend::Aria2(a),
                    });
                }
                Err(err) => {
                    tracing::warn!(
                        error = %err,
                        "aria2c engine failed to start, falling back to librqbit"
                    );
                }
            }
        }

        forget_saved(state_dir, keep);
        let peer_opts = Some(PeerConnectionOptions {
            connect_timeout: Some(Duration::from_secs(6)),
            read_write_timeout: Some(Duration::from_secs(15)),
            keep_alive_interval: Some(Duration::from_secs(60)),
        });
        let opts = SessionOptions {
            fastresume: true,
            persistence: Some(SessionPersistenceConfig::Json {
                folder: Some(state_dir.to_path_buf()),
            }),
            // Outbound-only TCP mode: avoids uTP slowdown and opens zero router/firewall ports.
            listen: None,
            connect: Some(ConnectionOptions {
                enable_tcp: true,
                peer_opts,
                ..Default::default()
            }),
            peer_limit: Some(256),
            runtime_worker_threads: Some(16),
            trackers: default_trackers(),
            client_name_and_version: Some(format!("HDM/{}", env!("CARGO_PKG_VERSION"))),
            ..Default::default()
        };
        Self::with_options(default_output, opts).await
    }

    /// A session that never touches the network (no DHT, trackers, listening or local
    /// discovery) and keeps no state: for tests.
    #[doc(hidden)]
    pub async fn start_offline(default_output: PathBuf) -> Result<Self> {
        let opts = SessionOptions {
            dht: None,
            disable_trackers: true,
            disable_local_service_discovery: true,
            listen: None,
            persistence: None,
            ..Default::default()
        };
        Self::with_options(default_output, opts).await
    }

    /// [`Self::start_offline`] with the state kept in `state_dir`, as [`Self::start`] does: for
    /// tests of what survives a restart.
    #[doc(hidden)]
    pub async fn start_offline_saved(
        state_dir: &Path,
        default_output: PathBuf,
        keep: &(dyn Fn(&str) -> bool + Send + Sync),
    ) -> Result<Self> {
        std::fs::create_dir_all(state_dir).context("create torrent state dir")?;
        forget_saved(state_dir, keep);
        let opts = SessionOptions {
            dht: None,
            disable_trackers: true,
            disable_local_service_discovery: true,
            listen: None,
            fastresume: true,
            persistence: Some(SessionPersistenceConfig::Json {
                folder: Some(state_dir.to_path_buf()),
            }),
            ..Default::default()
        };
        Self::with_options(default_output, opts).await
    }

    async fn with_options(default_output: PathBuf, opts: SessionOptions) -> Result<Self> {
        let session = Session::new_with_opts(default_output, opts)
            .await
            .context("start torrent session")?;
        Ok(Self {
            backend: Backend::Librqbit {
                session,
                inspected: Mutex::new(HashMap::new()),
            },
        })
    }

    /// Read a torrent's metadata (resolving a magnet via DHT/trackers) without downloading.
    pub async fn inspect(&self, source: &TorrentSource) -> Result<TorrentMeta> {
        match &self.backend {
            Backend::Aria2(a) => match a.inspect(source).await {
                Ok(meta) => Ok(meta),
                Err(aria_err) => {
                    if matches!(source, TorrentSource::Url(u) if u.trim_start().to_ascii_lowercase().starts_with("magnet:"))
                    {
                        tracing::warn!(error = %aria_err, "aria2 magnet inspect timed out, falling back to librqbit metadata resolver");
                        if let Ok(meta) = inspect_magnet_with_librqbit(source).await {
                            return Ok(meta);
                        }
                    }
                    Err(aria_err)
                }
            },
            Backend::Librqbit { session, inspected } => {
                let opts = AddTorrentOptions {
                    list_only: true,
                    ..Default::default()
                };
                let resp = session.add_torrent(source.to_add(), Some(opts)).await?;
                let meta = match resp {
                    AddTorrentResponse::ListOnly(list) => {
                        meta_from_info(list.info_hash.as_string(), &list.info)
                    }
                    AddTorrentResponse::AlreadyManaged(_, handle)
                    | AddTorrentResponse::Added(_, handle) => {
                        meta_from_handle(&handle).context("torrent metadata not resolved yet")?
                    }
                };
                if let TorrentSource::Url(url) = source {
                    let mut seen = inspected.lock().unwrap_or_else(|e| e.into_inner());
                    if seen.len() >= 64 {
                        seen.clear();
                    }
                    seen.insert(url.clone(), meta.clone());
                }
                Ok(meta)
            }
        }
    }

    /// Add (or re-attach to) a torrent and return its info-hash. A torrent with several
    /// files goes into its own folder inside `output_folder` (see [`content_path`]), like in
    /// other clients; a single file goes straight into `output_folder`.
    pub async fn add(
        &self,
        source: &TorrentSource,
        output_folder: &Path,
        only_files: Option<Vec<usize>>,
        paused: bool,
    ) -> Result<String> {
        self.add_with_options(source, output_folder, only_files, paused, false, false, &[], 0, 0)
            .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn add_with_options(
        &self,
        source: &TorrentSource,
        output_folder: &Path,
        only_files: Option<Vec<usize>>,
        paused: bool,
        force_recheck: bool,
        sequential: bool,
        extra_trackers: &[String],
        max_dl_bps: u64,
        max_ul_bps: u64,
    ) -> Result<String> {
        match &self.backend {
            Backend::Aria2(a) => {
                a.add_with_options(
                    source,
                    output_folder,
                    only_files,
                    paused,
                    force_recheck,
                    sequential,
                    extra_trackers,
                    max_dl_bps,
                    max_ul_bps,
                )
                .await
            }
            Backend::Librqbit { session, inspected } => {
                let meta = if let TorrentSource::Url(url) = source
                    && let Some(cached) = inspected
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .get(url)
                        .cloned()
                {
                    cached
                } else {
                    self.inspect(source).await?
                };
                let folder = if meta.files.len() >= 2 {
                    content_path(output_folder, &meta)
                } else {
                    output_folder.to_path_buf()
                };
                let opts = AddTorrentOptions {
                    paused,
                    only_files,
                    output_folder: Some(folder.to_string_lossy().into_owned()),
                    overwrite: true,
                    ..Default::default()
                };
                let resp = session.add_torrent(source.to_add(), Some(opts)).await?;
                let handle = resp.into_handle().context("torrent was not added")?;
                Ok(handle.info_hash().as_string())
            }
        }
    }

    fn librqbit_handle(&self, info_hash: &str) -> Option<ManagedTorrentHandle> {
        let Backend::Librqbit { session, .. } = &self.backend else {
            return None;
        };
        let id = librqbit::dht::Id20::from_str(info_hash).ok()?;
        session.get(TorrentIdOrHash::Hash(id))
    }

    pub fn is_managed(&self, info_hash: &str) -> bool {
        match &self.backend {
            Backend::Aria2(a) => a.is_managed(info_hash),
            Backend::Librqbit { .. } => self.librqbit_handle(info_hash).is_some(),
        }
    }

    pub fn meta(&self, info_hash: &str) -> Option<TorrentMeta> {
        match &self.backend {
            Backend::Aria2(a) => a.meta(info_hash),
            Backend::Librqbit { .. } => self
                .librqbit_handle(info_hash)
                .and_then(|h| meta_from_handle(&h)),
        }
    }

    pub fn progress(&self, info_hash: &str) -> Option<TorrentProgress> {
        match &self.backend {
            Backend::Aria2(a) => a.progress(info_hash),
            Backend::Librqbit { .. } => {
                let handle = self.librqbit_handle(info_hash)?;
                let stats = handle.stats();
                let live = stats.live.as_ref();
                let mib = |mbps: f64| (mbps * 1024.0 * 1024.0).max(0.0) as u64;
                let state = match stats.state {
                    TorrentStatsState::Initializing { .. } => TorrentState::Initializing,
                    TorrentStatsState::Paused => TorrentState::Paused,
                    TorrentStatsState::Error => TorrentState::Error,
                    TorrentStatsState::Live if stats.finished => TorrentState::Seeding,
                    TorrentStatsState::Live => TorrentState::Downloading,
                };
                let download_speed = live.map(|l| mib(l.download_speed.mbps)).unwrap_or(0);
                let remaining = stats.total_bytes.saturating_sub(stats.progress_bytes);
                Some(TorrentProgress {
                    state,
                    downloaded: stats.progress_bytes,
                    uploaded: stats.uploaded_bytes,
                    total: stats.total_bytes,
                    download_speed,
                    upload_speed: live.map(|l| mib(l.upload_speed.mbps)).unwrap_or(0),
                    peers: live.map(|l| l.snapshot.peer_stats.live).unwrap_or(0),
                    eta_secs: (download_speed > 0 && !stats.finished)
                        .then(|| remaining / download_speed),
                    finished: stats.finished,
                    error: stats.error.clone(),
                    name: handle.name(),
                })
            }
        }
    }

    pub async fn pause(&self, info_hash: &str) -> Result<()> {
        match &self.backend {
            Backend::Aria2(a) => a.pause(info_hash).await,
            Backend::Librqbit { session, .. } => {
                let handle = self.librqbit_handle(info_hash).context("unknown torrent")?;
                session.pause(&handle).await
            }
        }
    }

    pub async fn resume(&self, info_hash: &str) -> Result<()> {
        match &self.backend {
            Backend::Aria2(a) => a.resume(info_hash).await,
            Backend::Librqbit { session, .. } => {
                let handle = self.librqbit_handle(info_hash).context("unknown torrent")?;
                session.unpause(&handle).await
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn recheck(
        &self,
        source: &TorrentSource,
        info_hash: Option<&str>,
        output_folder: &Path,
        only_files: Option<Vec<usize>>,
        sequential: bool,
        extra_trackers: &[String],
        max_dl_bps: u64,
        max_ul_bps: u64,
    ) -> Result<String> {
        match &self.backend {
            Backend::Aria2(a) => {
                a.recheck(
                    source,
                    info_hash,
                    output_folder,
                    only_files,
                    sequential,
                    extra_trackers,
                    max_dl_bps,
                    max_ul_bps,
                )
                .await
            }
            Backend::Librqbit { .. } => {
                if let Some(h) = info_hash {
                    let _ = self.remove(h, false).await;
                }
                self.add(source, output_folder, only_files, false).await
            }
        }
    }

    pub async fn set_torrent_options(
        &self,
        info_hash: &str,
        sequential: Option<bool>,
        extra_trackers: Option<&[String]>,
        max_dl_bps: Option<u64>,
        max_ul_bps: Option<u64>,
    ) -> Result<()> {
        match &self.backend {
            Backend::Aria2(a) => {
                a.set_torrent_options(info_hash, sequential, extra_trackers, max_dl_bps, max_ul_bps)
                    .await
            }
            Backend::Librqbit { .. } => Ok(()),
        }
    }

    /// Stop managing a torrent, optionally deleting its files. Without deleting, its files are
    /// closed and stay where they are, and the session no longer remembers it.
    pub async fn remove(&self, info_hash: &str, delete_files: bool) -> Result<()> {
        match &self.backend {
            Backend::Aria2(a) => a.remove(info_hash, delete_files).await,
            Backend::Librqbit { session, .. } => {
                let id = librqbit::dht::Id20::from_str(info_hash)?;
                session
                    .delete(TorrentIdOrHash::Hash(id), delete_files)
                    .await
            }
        }
    }

    /// Global download limit in bytes/s (0 = unlimited). Upload is limited to the same
    /// value to keep the link usable while seeding.
    pub fn set_limits(&self, download_bps: u64, upload_bps: u64) {
        match &self.backend {
            Backend::Aria2(a) => a.set_limits(download_bps, upload_bps),
            Backend::Librqbit { session, .. } => {
                let nz = |v: u64| NonZeroU32::new(v.min(u32::MAX as u64) as u32);
                session.ratelimits.set_download_bps(nz(download_bps));
                session.ratelimits.set_upload_bps(nz(upload_bps));
            }
        }
    }

    pub async fn shutdown(&self) {
        match &self.backend {
            Backend::Aria2(a) => a.shutdown().await,
            Backend::Librqbit { session, .. } => session.stop().await,
        }
    }

    /// Default limits used by tests and as a template for the app.
    pub fn default_limits() -> LimitsConfig {
        LimitsConfig::default()
    }
}

/// Drops the torrents `keep` says no to from the session's saved state (librqbit's
/// `session.json` and its `<hash>.torrent` / `<hash>.bitv` files). Best effort: a state it can't
/// read is left as it is.
fn forget_saved(state_dir: &Path, keep: &dyn Fn(&str) -> bool) {
    let db = state_dir.join("session.json");
    let Ok(text) = std::fs::read_to_string(&db) else {
        return;
    };
    let Ok(mut doc) = serde_json::from_str::<serde_json::Value>(&text) else {
        tracing::warn!("unreadable torrent session state; left as it is");
        return;
    };
    let Some(torrents) = doc.get_mut("torrents").and_then(|t| t.as_object_mut()) else {
        return;
    };
    let gone: Vec<(String, String)> = torrents
        .iter()
        .filter_map(|(id, t)| {
            let hash = t.get("info_hash")?.as_str()?.to_ascii_lowercase();
            (!keep(&hash)).then(|| (id.clone(), hash))
        })
        .collect();
    if gone.is_empty() {
        return;
    }
    for (id, _) in &gone {
        torrents.remove(id);
    }
    let tmp = state_dir.join("session.json.prism-tmp");
    let written = serde_json::to_vec(&doc)
        .map_err(std::io::Error::other)
        .and_then(|bytes| std::fs::write(&tmp, bytes))
        .and_then(|()| std::fs::rename(&tmp, &db));
    if let Err(e) = written {
        tracing::warn!("could not update the torrent session state: {e}");
        let _ = std::fs::remove_file(&tmp);
        return;
    }
    for (_, hash) in &gone {
        for ext in ["torrent", "bitv"] {
            let _ = std::fs::remove_file(state_dir.join(format!("{hash}.{ext}")));
        }
    }
    tracing::info!("forgot {} finished torrents", gone.len());
}

/// Where a torrent's content ends up inside `output_folder`: its own folder (named after the
/// torrent) when it has several files, else the single file.
pub fn content_path(output_folder: &Path, meta: &TorrentMeta) -> PathBuf {
    match meta.files.as_slice() {
        [single] => output_folder.join(&single.path),
        _ => output_folder.join(folder_name(&meta.name)),
    }
}

/// The torrent's name as a single folder name that works on every system: no path
/// separators or characters Windows refuses, no trailing dots or spaces, no device names.
fn folder_name(name: &str) -> String {
    let mut s: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    while s.ends_with(['.', ' ']) {
        s.pop();
    }
    let s = s.trim_start().to_string();
    let stem = s.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && stem.as_bytes()[3].is_ascii_digit());
    match s.as_str() {
        "" | "." | ".." => "torrent".to_string(),
        _ if reserved => format!("{s}_"),
        _ => s,
    }
}

async fn inspect_magnet_with_librqbit(source: &TorrentSource) -> Result<TorrentMeta> {
    let tmp = std::env::temp_dir().join(format!("hdm-meta-{}", uuid::Uuid::new_v4().simple()));
    let _ = std::fs::create_dir_all(&tmp);
    let opts = SessionOptions {
        listen: None,
        persistence: None,
        trackers: default_trackers(),
        peer_limit: Some(128),
        runtime_worker_threads: Some(4),
        ..Default::default()
    };
    let session = Session::new_with_opts(tmp.clone(), opts)
        .await
        .context("start fallback magnet resolver")?;
    let add_opts = AddTorrentOptions {
        list_only: true,
        ..Default::default()
    };
    let res = tokio::time::timeout(
        Duration::from_secs(25),
        session.add_torrent(source.to_add(), Some(add_opts)),
    )
    .await
    .context("fallback magnet resolver timed out")??;
    let meta = match res {
        AddTorrentResponse::ListOnly(list) => meta_from_info(list.info_hash.as_string(), &list.info),
        AddTorrentResponse::AlreadyManaged(_, h) | AddTorrentResponse::Added(_, h) => {
            meta_from_handle(&h).context("torrent metadata not resolved")?
        }
    };
    session.stop().await;
    let _ = std::fs::remove_dir_all(&tmp);
    Ok(meta)
}

fn meta_from_handle(handle: &ManagedTorrentHandle) -> Option<TorrentMeta> {
    let hash = handle.info_hash().as_string();
    handle
        .with_metadata(|m| meta_from_info(hash.clone(), &m.info))
        .ok()
}

fn meta_from_info(
    info_hash: String,
    info: &ValidatedTorrentMetaV1Info<ByteBufOwned>,
) -> TorrentMeta {
    let files = info
        .iter_file_details()
        .enumerate()
        .map(|(index, fd)| TorrentFile {
            index,
            path: fd.filename.to_pathbuf().to_string_lossy().into_owned(),
            size: fd.len,
        })
        .collect::<Vec<_>>();
    TorrentMeta {
        info_hash,
        name: info
            .name()
            .map(|n| n.to_string())
            .unwrap_or_else(|| "torrent".into()),
        total_size: files.iter().map(|f| f.size).sum(),
        files,
    }
}

/// Serialize `.torrent` bytes as base64 so sources fit in JSON columns.
mod serde_bytes_b64 {
    use serde::{Deserialize, Deserializer, Serializer};

    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    pub fn serialize<S: Serializer>(bytes: &[u8], s: S) -> Result<S::Ok, S::Error> {
        let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
        for chunk in bytes.chunks(3) {
            let b = [
                chunk[0],
                *chunk.get(1).unwrap_or(&0),
                *chunk.get(2).unwrap_or(&0),
            ];
            let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
            for i in 0..4 {
                if i <= chunk.len() {
                    out.push(ALPHABET[(n >> (18 - 6 * i) & 63) as usize] as char);
                } else {
                    out.push('=');
                }
            }
        }
        s.serialize_str(&out)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        let s = String::deserialize(d)?;
        let mut out = Vec::with_capacity(s.len() / 4 * 3);
        let mut buf = 0u32;
        let mut bits = 0;
        for c in s.bytes().filter(|c| *c != b'=') {
            let v = ALPHABET
                .iter()
                .position(|a| *a == c)
                .ok_or_else(|| serde::de::Error::custom("invalid base64"))?
                as u32;
            buf = buf << 6 | v;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push((buf >> bits) as u8);
                buf &= (1 << bits) - 1;
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_roundtrip_base64() {
        for data in [
            vec![],
            vec![1u8],
            vec![1, 2],
            vec![1, 2, 3],
            (0..=255u8).collect(),
        ] {
            let src = TorrentSource::File(data.clone());
            let json = serde_json::to_string(&src).unwrap();
            assert_eq!(serde_json::from_str::<TorrentSource>(&json).unwrap(), src);
        }
    }
}
