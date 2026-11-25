//! High-speed C++ `libtorrent-rasterbar` (2.1.x, qBittorrent's exact engine) backend
//! powered by the bundled standalone `hdm-libtorrent` sidecar over localhost HTTP JSON.

use crate::{TorrentMeta, TorrentProgress, TorrentSource, TorrentState};
use anyhow::{Context, Result, anyhow};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::process::Child;

/// Top public BitTorrent trackers (ngosang/trackerslist best) for rapid peer discovery.
pub const TOP_PUBLIC_TRACKERS: &[&str] = &[
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://tracker.tiny-vps.com:6969/announce",
    "https://tracker.tamersunion.org:443/announce",
    "udp://explodie.org:6969/announce",
    "udp://tracker.bittor.pw:1337/announce",
    "udp://tracker.dler.org:6969/announce",
    "udp://p4p.arenabg.com:1337/announce",
    "udp://tracker.moeking.me:6969/announce",
    "udp://retracker.lanta.me:2710/announce",
    "udp://tracker.srv00.com:6969/announce",
    "udp://tracker.filemail.com:6969/announce",
    "udp://tracker1.bt.moack.co.kr:80/announce",
    "udp://tracker.theoks.net:6969/announce",
    "udp://opentracker.io:6969/announce",
    "udp://movies.zsw.ca:6969/announce",
    "http://tracker.openbittorrent.com:80/announce",
];

#[derive(Debug, Clone)]
struct LtRecord {
    meta: Option<TorrentMeta>,
    progress: TorrentProgress,
}

pub struct LibtorrentBackend {
    base_url: String,
    secret: String,
    client: reqwest::Client,
    child: Mutex<Option<Child>>,
    records: Arc<Mutex<HashMap<String, LtRecord>>>,
    inspected: Mutex<HashMap<String, TorrentMeta>>,
    poll_abort: tokio::task::AbortHandle,
}

/// Locate the bundled `hdm-libtorrent` standalone executable next to `hdm.exe` or in dev binaries.
pub fn find_libtorrent_sidecar() -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        for name in [
            "hdm-libtorrent.exe",
            "hdm-libtorrent-x86_64-pc-windows-msvc.exe",
            "hdm-libtorrent",
        ] {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        // Dev fallback when running `target/release/hdm.exe` directly from repo root
        let mut cur = Some(dir);
        for _ in 0..4 {
            if let Some(p) = cur {
                let dev_bin = p
                    .join("app")
                    .join("src-tauri")
                    .join("binaries")
                    .join("hdm-libtorrent-x86_64-pc-windows-msvc.exe");
                if dev_bin.is_file() {
                    return Some(dev_bin);
                }
                cur = p.parent();
            }
        }
    }
    None
}

fn pick_free_local_port() -> Result<u16> {
    let listener =
        TcpListener::bind("127.0.0.1:0").context("bind ephemeral port for hdm-libtorrent")?;
    Ok(listener.local_addr()?.port())
}

fn encode_base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
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
    out
}

fn parse_status_entry(val: &Value) -> Option<LtRecord> {
    let state = match val.get("state").and_then(|v| v.as_str()).unwrap_or("paused") {
        "initializing" => TorrentState::Initializing,
        "downloading" => TorrentState::Downloading,
        "seeding" => TorrentState::Seeding,
        "error" => TorrentState::Error,
        _ => TorrentState::Paused,
    };
    let meta = val
        .get("meta")
        .filter(|v| !v.is_null())
        .and_then(|m| serde_json::from_value::<TorrentMeta>(m.clone()).ok());

    let progress = TorrentProgress {
        state,
        downloaded: val.get("downloaded").and_then(|v| v.as_u64()).unwrap_or(0),
        uploaded: val.get("uploaded").and_then(|v| v.as_u64()).unwrap_or(0),
        total: val.get("total").and_then(|v| v.as_u64()).unwrap_or(0),
        download_speed: val
            .get("downloadSpeed")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        upload_speed: val
            .get("uploadSpeed")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        peers: val.get("peers").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        eta_secs: val.get("etaSecs").and_then(|v| v.as_u64()),
        finished: val.get("finished").and_then(|v| v.as_bool()).unwrap_or(false),
        error: val
            .get("error")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        name: val
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    };
    Some(LtRecord { meta, progress })
}

impl LibtorrentBackend {
    pub async fn start(
        binary: PathBuf,
        state_dir: &Path,
        default_output: PathBuf,
    ) -> Result<Self> {
        std::fs::create_dir_all(state_dir).context("create libtorrent state dir")?;
        let port = pick_free_local_port()?;
        let secret = uuid::Uuid::new_v4().simple().to_string();
        let base_url = format!("http://127.0.0.1:{port}");
        let pid = std::process::id();

        let mut cmd = tokio::process::Command::new(&binary);
        cmd.args([
            "--port",
            &port.to_string(),
            "--secret",
            &secret,
            "--state-dir",
            &state_dir.to_string_lossy(),
            "--default-dir",
            &default_output.to_string_lossy(),
            "--parent-pid",
            &pid.to_string(),
        ]);
        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);

        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let child = cmd
            .spawn()
            .with_context(|| format!("spawn hdm-libtorrent at {}", binary.display()))?;

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(45))
            .no_proxy()
            .build()
            .context("build libtorrent HTTP client")?;

        // Wait up to 8 seconds for PyInstaller onefile unpack + libtorrent startup.
        let mut ready = false;
        let health_url = format!("{base_url}/health");
        for _ in 0..80 {
            if let Ok(resp) = client
                .get(&health_url)
                .header("X-HDM-Token", &secret)
                .send()
                .await
                && resp.status().is_success()
            {
                ready = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        if !ready {
            return Err(anyhow!(
                "hdm-libtorrent daemon did not become ready on 127.0.0.1:{port}"
            ));
        }

        let records: Arc<Mutex<HashMap<String, LtRecord>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let poll_client = client.clone();
        let status_url = format!("{base_url}/status");
        let poll_secret = secret.clone();
        let poll_records = records.clone();
        let poll_task = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(500));
            loop {
                interval.tick().await;
                let Ok(resp) = poll_client
                    .get(&status_url)
                    .header("X-HDM-Token", &poll_secret)
                    .send()
                    .await
                else {
                    continue;
                };
                let Ok(Value::Object(map)) = resp.json::<Value>().await else {
                    continue;
                };
                let mut guard = poll_records.lock().unwrap_or_else(|e| e.into_inner());
                for (hash, entry) in map {
                    if let Some(rec) = parse_status_entry(&entry) {
                        guard.insert(hash.to_ascii_lowercase(), rec);
                    }
                }
            }
        });

        tracing::info!(
            port,
            binary = %binary.display(),
            "started libtorrent-rasterbar sidecar engine"
        );

        Ok(Self {
            base_url,
            secret,
            client,
            child: Mutex::new(Some(child)),
            records,
            inspected: Mutex::new(HashMap::new()),
            poll_abort: poll_task.abort_handle(),
        })
    }

    async fn post(&self, path: &str, body: Value) -> Result<Value> {
        let url = format!("{}{path}", self.base_url);
        let resp = self
            .client
            .post(&url)
            .header("X-HDM-Token", &self.secret)
            .json(&body)
            .send()
            .await
            .with_context(|| format!("libtorrent POST {path} failed"))?;
        let status = resp.status();
        let val: Value = resp
            .json()
            .await
            .with_context(|| format!("decode libtorrent response for {path}"))?;
        if !status.is_success() {
            let msg = val
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("libtorrent sidecar error");
            return Err(anyhow!("{msg}"));
        }
        Ok(val)
    }

    pub async fn inspect(&self, source: &TorrentSource) -> Result<TorrentMeta> {
        if let TorrentSource::Url(url) = source
            && let Some(cached) = self
                .inspected
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .get(url)
                .cloned()
        {
            return Ok(cached);
        }

        let body = match source {
            TorrentSource::Url(url) => json!({ "url": url }),
            TorrentSource::File(bytes) => json!({ "fileB64": encode_base64(bytes) }),
        };
        let val = self.post("/inspect", body).await?;
        let meta: TorrentMeta =
            serde_json::from_value(val).context("parse TorrentMeta from libtorrent")?;

        if let TorrentSource::Url(url) = source {
            let mut seen = self.inspected.lock().unwrap_or_else(|e| e.into_inner());
            if seen.len() >= 64 {
                seen.clear();
            }
            seen.insert(url.clone(), meta.clone());
        }
        Ok(meta)
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
        let mut body = serde_json::Map::new();
        match source {
            TorrentSource::Url(url) => {
                body.insert("url".into(), json!(url));
            }
            TorrentSource::File(bytes) => {
                body.insert("fileB64".into(), json!(encode_base64(bytes)));
            }
        }
        body.insert("saveDir".into(), json!(output_folder.to_string_lossy()));
        body.insert("paused".into(), json!(paused));
        body.insert("forceRecheck".into(), json!(force_recheck));
        body.insert("sequential".into(), json!(sequential));
        body.insert("extraTrackers".into(), json!(extra_trackers));
        body.insert("maxDlBps".into(), json!(max_dl_bps));
        body.insert("maxUlBps".into(), json!(max_ul_bps));
        if let Some(files) = only_files {
            body.insert("onlyFiles".into(), json!(files));
        }

        let val = self.post("/add", Value::Object(body)).await?;
        let info_hash = val
            .get("infoHash")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("libtorrent /add missing infoHash"))?
            .to_ascii_lowercase();

        let cached_meta = match source {
            TorrentSource::Url(url) => self
                .inspected
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .get(url)
                .cloned(),
            _ => None,
        };

        self.records
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entry(info_hash.clone())
            .or_insert_with(|| LtRecord {
                meta: cached_meta.clone(),
                progress: TorrentProgress {
                    state: if paused {
                        TorrentState::Paused
                    } else {
                        TorrentState::Initializing
                    },
                    downloaded: 0,
                    uploaded: 0,
                    total: cached_meta.as_ref().map(|m| m.total_size).unwrap_or(0),
                    download_speed: 0,
                    upload_speed: 0,
                    peers: 0,
                    eta_secs: None,
                    finished: false,
                    error: None,
                    name: cached_meta.as_ref().map(|m| m.name.clone()),
                },
            });

        Ok(info_hash)
    }

    pub fn is_managed(&self, info_hash: &str) -> bool {
        let key = info_hash.to_ascii_lowercase();
        self.records
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&key)
            .is_some_and(|r| r.progress.state != TorrentState::Error)
    }

    pub fn meta(&self, info_hash: &str) -> Option<TorrentMeta> {
        let key = info_hash.to_ascii_lowercase();
        self.records
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&key)
            .and_then(|r| r.meta.clone())
    }

    pub fn progress(&self, info_hash: &str) -> Option<TorrentProgress> {
        let key = info_hash.to_ascii_lowercase();
        self.records
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&key)
            .map(|r| r.progress.clone())
    }

    pub async fn pause(&self, info_hash: &str) -> Result<()> {
        let key = info_hash.to_ascii_lowercase();
        let _ = self.post("/pause", json!({ "infoHash": key })).await;
        if let Some(rec) = self
            .records
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get_mut(&key)
        {
            rec.progress.state = TorrentState::Paused;
            rec.progress.download_speed = 0;
        }
        Ok(())
    }

    pub async fn resume(&self, info_hash: &str) -> Result<()> {
        let key = info_hash.to_ascii_lowercase();
        let _ = self.post("/resume", json!({ "infoHash": key })).await?;
        Ok(())
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
        if let Some(h) = info_hash
            && self.is_managed(h)
        {
            let key = h.to_ascii_lowercase();
            if self.post("/recheck", json!({ "infoHash": key })).await.is_ok() {
                return Ok(key);
            }
        }
        self.add_with_options(
            source,
            output_folder,
            only_files,
            false,
            true,
            sequential,
            extra_trackers,
            max_dl_bps,
            max_ul_bps,
        )
        .await
    }

    pub async fn set_torrent_options(
        &self,
        info_hash: &str,
        sequential: Option<bool>,
        extra_trackers: Option<&[String]>,
        max_dl_bps: Option<u64>,
        max_ul_bps: Option<u64>,
    ) -> Result<()> {
        let key = info_hash.to_ascii_lowercase();
        let mut body = serde_json::Map::new();
        body.insert("infoHash".into(), json!(key));
        if let Some(s) = sequential {
            body.insert("sequential".into(), json!(s));
        }
        if let Some(t) = extra_trackers {
            body.insert("extraTrackers".into(), json!(t));
        }
        if let Some(dl) = max_dl_bps {
            body.insert("maxDlBps".into(), json!(dl));
        }
        if let Some(ul) = max_ul_bps {
            body.insert("maxUlBps".into(), json!(ul));
        }
        let _ = self.post("/options", Value::Object(body)).await?;
        Ok(())
    }

    pub async fn remove(&self, info_hash: &str, delete_files: bool) -> Result<()> {
        let key = info_hash.to_ascii_lowercase();
        self.records
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&key);
        let _ = self
            .post(
                "/remove",
                json!({ "infoHash": key, "deleteFiles": delete_files }),
            )
            .await;
        Ok(())
    }

    pub fn set_limits(&self, download_bps: u64, upload_bps: u64) {
        let client = self.client.clone();
        let url = format!("{}/limits", self.base_url);
        let secret = self.secret.clone();
        tokio::spawn(async move {
            let _ = client
                .post(&url)
                .header("X-HDM-Token", &secret)
                .json(&json!({
                    "downloadBps": download_bps,
                    "uploadBps": upload_bps,
                }))
                .send()
                .await;
        });
    }

    pub async fn shutdown(&self) {
        self.poll_abort.abort();
        let _ = self.post("/shutdown", json!({})).await;
        let child = self.child.lock().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(mut c) = child {
            let _ = c.kill().await;
        }
    }
}
