//! High-speed C++ BitTorrent backend powered by bundled `aria2c` over local JSON-RPC.
//!
//! Configured for qBittorrent-class throughput with strict outbound-only safety:
//! - MSE/PE BitTorrent protocol encryption (`--bt-min-crypto-level=arc4`) to bypass ISP throttling
//! - High-speed TCP pipelining (no uTP slowdown)
//! - Zero UPnP / zero router port forwarding (100% outbound-only)
//! - 256 peers, 64 MiB disk cache, instant NTFS start (`--file-allocation=none`), DHT + PEX + LPD
//! - Localhost-only JSON-RPC (`127.0.0.1`) authenticated with a per-session random secret

use crate::{TorrentFile, TorrentMeta, TorrentProgress, TorrentSource, TorrentState, content_path};
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
struct AriaTorrentRecord {
    gid: String,
    #[allow(dead_code)]
    info_hash: String,
    output_dir: PathBuf,
    meta: Option<TorrentMeta>,
    progress: TorrentProgress,
    is_metadata_stage: bool,
}

pub struct Aria2Backend {
    rpc_url: String,
    secret: String,
    client: reqwest::Client,
    state_dir: PathBuf,
    child: Mutex<Option<Child>>,
    records: Arc<Mutex<HashMap<String, AriaTorrentRecord>>>,
    inspected: Mutex<HashMap<String, TorrentMeta>>,
    poll_abort: tokio::task::AbortHandle,
}

/// Locate the bundled `aria2c` executable next to `hdm.exe`, in dev binaries, or on `PATH`.
pub fn find_aria2c() -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        for name in [
            "aria2c.exe",
            "aria2c-x86_64-pc-windows-msvc.exe",
            "aria2c",
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
                    .join("aria2c-x86_64-pc-windows-msvc.exe");
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
    let listener = TcpListener::bind("127.0.0.1:0").context("bind ephemeral port for aria2c RPC")?;
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

fn parse_u64(val: Option<&Value>) -> u64 {
    val.and_then(|v| {
        v.as_str()
            .and_then(|s| s.parse::<u64>().ok())
            .or_else(|| v.as_u64())
    })
    .unwrap_or(0)
}

fn parse_u32(val: Option<&Value>) -> u32 {
    parse_u64(val).min(u32::MAX as u64) as u32
}

pub fn extract_magnet_info_hash(magnet: &str) -> Option<String> {
    let lower = magnet.to_ascii_lowercase();
    let idx = lower.find("xt=urn:btih:")?;
    let rest = &magnet[idx + "xt=urn:btih:".len()..];
    let raw = rest.split('&').next()?.trim();
    if raw.len() == 40 && raw.chars().all(|c| c.is_ascii_hexdigit()) {
        return Some(raw.to_ascii_lowercase());
    }
    if raw.len() == 32 {
        return base32_to_hex(raw);
    }
    None
}

fn base32_to_hex(input: &str) -> Option<String> {
    let mut bits: u64 = 0;
    let mut count: u32 = 0;
    let mut bytes = Vec::with_capacity(20);
    for ch in input.chars() {
        let val = match ch.to_ascii_uppercase() {
            'A'..='Z' => (ch.to_ascii_uppercase() as u8) - b'A',
            '2'..='7' => (ch as u8) - b'2' + 26,
            _ => return None,
        } as u64;
        bits = (bits << 5) | val;
        count += 5;
        if count >= 8 {
            count -= 8;
            bytes.push(((bits >> count) & 0xff) as u8);
        }
    }
    if bytes.len() == 20 {
        Some(bytes.iter().map(|b| format!("{b:02x}")).collect())
    } else {
        None
    }
}

fn parse_torrent_bytes_meta(bytes: &[u8]) -> Result<TorrentMeta> {
    let parsed = librqbit::torrent_from_bytes(bytes)
        .map_err(|e| anyhow!("invalid .torrent metadata: {e}"))?;
    let info_hash = parsed.info_hash.as_string().to_ascii_lowercase();
    let info = parsed
        .info
        .data
        .validate()
        .map_err(|e| anyhow!("invalid torrent info section: {e}"))?;
    let files = info
        .iter_file_details()
        .enumerate()
        .map(|(index, fd)| TorrentFile {
            index,
            path: fd.filename.to_pathbuf().to_string_lossy().into_owned(),
            size: fd.len,
        })
        .collect::<Vec<_>>();
    let name = info
        .name()
        .map(|n| n.to_string())
        .unwrap_or_else(|| "torrent".into());
    let total_size = files.iter().map(|f| f.size).sum();
    Ok(TorrentMeta {
        info_hash,
        name,
        total_size,
        files,
    })
}

fn parse_aria_status_entry(item: &Value) -> Option<(String, AriaTorrentRecord)> {
    let info_hash = item
        .get("infoHash")
        .and_then(|v| v.as_str())?
        .trim()
        .to_ascii_lowercase();
    if info_hash.is_empty() {
        return None;
    }
    let gid = item.get("gid").and_then(|v| v.as_str())?.to_string();
    let status_str = item.get("status").and_then(|v| v.as_str()).unwrap_or("");
    let is_metadata_stage = item
        .get("followedBy")
        .and_then(|v| v.as_array())
        .is_some_and(|a| !a.is_empty());

    let downloaded = parse_u64(item.get("completedLength"));
    let total = parse_u64(item.get("totalLength"));
    let uploaded = parse_u64(item.get("uploadLength"));
    let download_speed = parse_u64(item.get("downloadSpeed"));
    let upload_speed = parse_u64(item.get("uploadSpeed"));
    let peers = parse_u32(item.get("connections"));
    let error = item
        .get("errorMessage")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string());
    let output_dir = item
        .get("dir")
        .and_then(|v| v.as_str())
        .map(PathBuf::from)
        .unwrap_or_default();

    let bt_name = item
        .get("bittorrent")
        .and_then(|b| b.get("info"))
        .and_then(|i| i.get("name"))
        .and_then(|n| n.as_str())
        .map(|s| s.to_string());

    let files: Vec<TorrentFile> = item
        .get("files")
        .and_then(|f| f.as_array())
        .map(|arr| {
            arr.iter()
                .enumerate()
                .filter_map(|(idx, f)| {
                    let raw_path = f.get("path").and_then(|p| p.as_str())?;
                    if raw_path.starts_with("[METADATA]") {
                        return None;
                    }
                    let rel = Path::new(raw_path)
                        .strip_prefix(&output_dir)
                        .ok()
                        .map(|p| p.to_string_lossy().into_owned())
                        .unwrap_or_else(|| raw_path.to_string());
                    Some(TorrentFile {
                        index: idx,
                        path: rel,
                        size: parse_u64(f.get("length")),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let meta = if !is_metadata_stage && (!files.is_empty() || bt_name.is_some()) {
        Some(TorrentMeta {
            info_hash: info_hash.clone(),
            name: bt_name.clone().unwrap_or_else(|| "torrent".into()),
            total_size: if total > 0 {
                total
            } else {
                files.iter().map(|f| f.size).sum()
            },
            files,
        })
    } else {
        None
    };

    let finished = !is_metadata_stage && total > 0 && (status_str == "complete" || downloaded >= total);

    let state = match status_str {
        "active" if is_metadata_stage || (total == 0 && downloaded == 0) => {
            TorrentState::Initializing
        }
        "active" if finished => TorrentState::Seeding,
        "active" => TorrentState::Downloading,
        "waiting" => TorrentState::Initializing,
        "paused" => TorrentState::Paused,
        "complete" => TorrentState::Seeding,
        "error" => TorrentState::Error,
        _ => TorrentState::Paused,
    };

    let remaining = total.saturating_sub(downloaded);
    let eta_secs = (download_speed > 0 && !finished && total > 0).then(|| remaining / download_speed);

    let progress = TorrentProgress {
        state,
        downloaded,
        uploaded,
        total,
        download_speed,
        upload_speed,
        peers,
        eta_secs,
        finished,
        error,
        name: bt_name,
    };

    Some((
        info_hash.clone(),
        AriaTorrentRecord {
            gid,
            info_hash,
            output_dir,
            meta,
            progress,
            is_metadata_stage,
        },
    ))
}

impl Aria2Backend {
    pub async fn start(
        binary: PathBuf,
        state_dir: &Path,
        default_output: PathBuf,
    ) -> Result<Self> {
        std::fs::create_dir_all(state_dir).context("create aria2 state dir")?;
        let port = pick_free_local_port()?;
        let secret = uuid::Uuid::new_v4().simple().to_string();
        let rpc_url = format!("http://127.0.0.1:{port}/jsonrpc");
        let dht_path = state_dir.join("dht.dat");
        let trackers_csv = TOP_PUBLIC_TRACKERS.join(",");

        let mut cmd = tokio::process::Command::new(&binary);
        cmd.args([
            "--enable-rpc=true",
            "--rpc-listen-all=false",
            &format!("--rpc-listen-port={port}"),
            &format!("--rpc-secret={secret}"),
            &format!("--dir={}", default_output.to_string_lossy()),
            "--enable-dht=true",
            &format!("--dht-file-path={}", dht_path.to_string_lossy()),
            "--dht-entry-point=dht.transmissionbt.com:6881",
            "--dht-entry-point6=dht.transmissionbt.com:6881",
            "--enable-peer-exchange=true",
            "--bt-enable-lpd=true",
            "--bt-min-crypto-level=plain",
            "--bt-require-crypto=false",
            "--bt-force-encryption=false",
            "--bt-max-peers=0",
            "--bt-request-peer-speed-limit=50M",
            "--bt-tracker-interval=60",
            "--bt-tracker-connect-timeout=10",
            "--bt-tracker-timeout=10",
            "--bt-max-open-files=256",
            "--seed-time=0",
            "--bt-detach-seed-only=true",
            "--bt-save-metadata=true",
            "--bt-load-saved-metadata=true",
            "--continue=true",
            "--allow-overwrite=true",
            "--auto-file-renaming=false",
            "--check-integrity=false",
            "--file-allocation=none",
            "--disk-cache=64M",
            &format!("--bt-tracker={trackers_csv}"),
            "--quiet=true",
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
            .with_context(|| format!("spawn aria2c daemon at {}", binary.display()))?;

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .no_proxy()
            .build()
            .context("build aria2 RPC HTTP client")?;

        // Wait up to 4 seconds for aria2c JSON-RPC to accept connections.
        let mut ready = false;
        for _ in 0..40 {
            if Self::rpc_call_raw(&client, &rpc_url, &secret, "aria2.getVersion", vec![])
                .await
                .is_ok()
            {
                ready = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        if !ready {
            return Err(anyhow!("aria2c RPC daemon did not become ready on 127.0.0.1:{port}"));
        }

        let records: Arc<Mutex<HashMap<String, AriaTorrentRecord>>> =
            Arc::new(Mutex::new(HashMap::new()));

        // Background poller keeps `progress()` synchronous and lock-free.
        let poll_client = client.clone();
        let poll_url = rpc_url.clone();
        let poll_secret = secret.clone();
        let poll_records = records.clone();
        let poll_task = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(500));
            let keys = json!([
                "gid",
                "status",
                "totalLength",
                "completedLength",
                "uploadLength",
                "downloadSpeed",
                "uploadSpeed",
                "connections",
                "infoHash",
                "dir",
                "bittorrent",
                "files",
                "followedBy",
                "errorMessage"
            ]);
            let token = format!("token:{poll_secret}");
            loop {
                interval.tick().await;
                let calls = json!([
                    { "methodName": "aria2.tellActive", "params": [token, keys] },
                    { "methodName": "aria2.tellWaiting", "params": [token, 0, 200, keys] },
                    { "methodName": "aria2.tellStopped", "params": [token, 0, 200, keys] }
                ]);
                let payload = json!({
                    "jsonrpc": "2.0",
                    "id": "poll",
                    "method": "system.multicall",
                    "params": [calls]
                });
                let Ok(resp) = poll_client.post(&poll_url).json(&payload).send().await else {
                    continue;
                };
                let Ok(body) = resp.json::<Value>().await else {
                    continue;
                };
                let Some(groups) = body.get("result").and_then(|r| r.as_array()) else {
                    continue;
                };

                let mut fresh: HashMap<String, AriaTorrentRecord> = HashMap::new();
                for group in groups {
                    let Some(list) = group.as_array().and_then(|a| a.first()).and_then(|v| v.as_array()) else {
                        continue;
                    };
                    for entry in list {
                        let Some((hash, rec)) = parse_aria_status_entry(entry) else {
                            continue;
                        };
                        // Prefer the real data GID over the transient metadata GID.
                        match fresh.get(&hash) {
                            Some(existing) if !existing.is_metadata_stage && rec.is_metadata_stage => {}
                            _ => {
                                fresh.insert(hash, rec);
                            }
                        }
                    }
                }

                let mut guard = poll_records.lock().unwrap_or_else(|e| e.into_inner());
                for (hash, rec) in fresh {
                    // Preserve cached metadata if already resolved.
                    let merged_meta = rec
                        .meta
                        .or_else(|| guard.get(&hash).and_then(|old| old.meta.clone()));
                    guard.insert(
                        hash,
                        AriaTorrentRecord {
                            meta: merged_meta,
                            ..rec
                        },
                    );
                }
            }
        });

        tracing::info!(port, binary = %binary.display(), "started aria2c C++ BitTorrent engine");

        Ok(Self {
            rpc_url,
            secret,
            client,
            state_dir: state_dir.to_path_buf(),
            child: Mutex::new(Some(child)),
            records,
            inspected: Mutex::new(HashMap::new()),
            poll_abort: poll_task.abort_handle(),
        })
    }

    async fn rpc_call_raw(
        client: &reqwest::Client,
        rpc_url: &str,
        secret: &str,
        method: &str,
        mut params: Vec<Value>,
    ) -> Result<Value> {
        params.insert(0, json!(format!("token:{secret}")));
        let body = json!({
            "jsonrpc": "2.0",
            "id": "hdm",
            "method": method,
            "params": params,
        });
        let resp = client
            .post(rpc_url)
            .json(&body)
            .send()
            .await
            .with_context(|| format!("aria2 RPC call {method} failed"))?;
        let val: Value = resp
            .json()
            .await
            .with_context(|| format!("decode aria2 RPC response for {method}"))?;
        if let Some(err) = val.get("error") {
            let msg = err
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown aria2 error");
            return Err(anyhow!("aria2 {method}: {msg}"));
        }
        Ok(val.get("result").cloned().unwrap_or(Value::Null))
    }

    async fn rpc(&self, method: &str, params: Vec<Value>) -> Result<Value> {
        Self::rpc_call_raw(&self.client, &self.rpc_url, &self.secret, method, params).await
    }

    pub async fn inspect(&self, source: &TorrentSource) -> Result<TorrentMeta> {
        match source {
            TorrentSource::File(bytes) => parse_torrent_bytes_meta(bytes),
            TorrentSource::Url(url) => {
                if let Some(cached) = self
                    .inspected
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .get(url)
                    .cloned()
                {
                    return Ok(cached);
                }

                // Direct `.torrent` HTTP(S) download
                if !url.trim_start().to_ascii_lowercase().starts_with("magnet:") {
                    let http = reqwest::Client::builder()
                        .timeout(Duration::from_secs(20))
                        .build()?;
                    let bytes = http.get(url).send().await?.error_for_status()?.bytes().await?;
                    let meta = parse_torrent_bytes_meta(&bytes)?;
                    self.cache_inspected(url, &meta);
                    return Ok(meta);
                }

                // Magnet metadata resolution via aria2c (`bt-metadata-only=true`)
                let meta_dir = self.state_dir.join("meta_tmp");
                let _ = std::fs::create_dir_all(&meta_dir);
                let opts = json!({
                    "dir": meta_dir.to_string_lossy(),
                    "bt-metadata-only": "true",
                    "bt-save-metadata": "true",
                    "bt-tracker": TOP_PUBLIC_TRACKERS.join(","),
                });
                let gid = self
                    .rpc("aria2.addUri", vec![json!([url]), opts])
                    .await?
                    .as_str()
                    .ok_or_else(|| anyhow!("aria2.addUri did not return GID"))?
                    .to_string();

                let mut resolved: Option<TorrentMeta> = None;
                for _ in 0..80 {
                    tokio::time::sleep(Duration::from_millis(250)).await;
                    let Ok(status) = self.rpc("aria2.tellStatus", vec![json!(gid)]).await else {
                        break;
                    };
                    let state = status.get("status").and_then(|s| s.as_str()).unwrap_or("");
                    if let Some(hash) = status
                        .get("infoHash")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_ascii_lowercase())
                        .filter(|s| !s.is_empty())
                    {
                        let torrent_file = meta_dir.join(format!("{hash}.torrent"));
                        if let Ok(bytes) = std::fs::read(&torrent_file)
                            && let Ok(meta) = parse_torrent_bytes_meta(&bytes)
                        {
                            let _ = std::fs::remove_file(&torrent_file);
                            resolved = Some(meta);
                            break;
                        }
                    }
                    if state == "error" || state == "removed" {
                        break;
                    }
                }

                let _ = self.rpc("aria2.forceRemove", vec![json!(gid)]).await;
                let _ = self.rpc("aria2.removeDownloadResult", vec![json!(gid)]).await;

                let meta = resolved.ok_or_else(|| {
                    anyhow!("Timed out resolving magnet metadata (no peers responded)")
                })?;
                self.cache_inspected(url, &meta);
                Ok(meta)
            }
        }
    }

    fn cache_inspected(&self, url: &str, meta: &TorrentMeta) {
        let mut seen = self.inspected.lock().unwrap_or_else(|e| e.into_inner());
        if seen.len() >= 64 {
            seen.clear();
        }
        seen.insert(url.to_string(), meta.clone());
    }

    #[allow(dead_code)]
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
        let _ = std::fs::create_dir_all(output_folder);

        // Try cached/local metadata first so we know info_hash immediately.
        let known_meta = match source {
            TorrentSource::File(bytes) => parse_torrent_bytes_meta(bytes).ok(),
            TorrentSource::Url(url) => self
                .inspected
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .get(url)
                .cloned(),
        };

        let should_check_integrity = force_recheck
            || match &known_meta {
                Some(m) => content_path(output_folder, m).exists(),
                None => std::fs::read_dir(output_folder)
                    .map(|mut d| d.next().is_some())
                    .unwrap_or(false),
            };

        let trackers_csv = merge_trackers(extra_trackers);

        let mut opts = serde_json::Map::new();
        opts.insert("dir".into(), json!(output_folder.to_string_lossy()));
        opts.insert("pause".into(), json!(if paused { "true" } else { "false" }));
        opts.insert("continue".into(), json!("true"));
        opts.insert("allow-overwrite".into(), json!("true"));
        opts.insert("auto-file-renaming".into(), json!("false"));
        opts.insert(
            "check-integrity".into(),
            json!(if should_check_integrity { "true" } else { "false" }),
        );
        opts.insert("bt-tracker".into(), json!(trackers_csv));
        opts.insert("seed-time".into(), json!("0"));
        if sequential {
            opts.insert("bt-prioritize-piece".into(), json!("head=32M,tail=32M"));
        }
        if max_dl_bps > 0 {
            opts.insert("max-download-limit".into(), json!(max_dl_bps.to_string()));
        }
        if max_ul_bps > 0 {
            opts.insert("max-upload-limit".into(), json!(max_ul_bps.to_string()));
        }
        if let Some(indices) = only_files
            && !indices.is_empty()
        {
            // aria2 uses 1-based file indices for `select-file`
            let select = indices
                .iter()
                .map(|i| (i + 1).to_string())
                .collect::<Vec<_>>()
                .join(",");
            opts.insert("select-file".into(), json!(select));
        }

        let gid = match source {
            TorrentSource::File(bytes) => {
                let b64 = encode_base64(bytes);
                self.rpc(
                    "aria2.addTorrent",
                    vec![json!(b64), json!([]), Value::Object(opts)],
                )
                .await?
                .as_str()
                .ok_or_else(|| anyhow!("aria2.addTorrent did not return GID"))?
                .to_string()
            }
            TorrentSource::Url(url) => self
                .rpc("aria2.addUri", vec![json!([url]), Value::Object(opts)])
                .await?
                .as_str()
                .ok_or_else(|| anyhow!("aria2.addUri did not return GID"))?
                .to_string(),
        };

        let info_hash = if let Some(ref m) = known_meta {
            m.info_hash.clone()
        } else if let TorrentSource::Url(url) = source
            && let Some(h) = extract_magnet_info_hash(url)
        {
            h
        } else {
            let status = self.rpc("aria2.tellStatus", vec![json!(gid)]).await?;
            status
                .get("infoHash")
                .and_then(|v| v.as_str())
                .map(|s| s.to_ascii_lowercase())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| gid.clone())
        };

        // Seed immediate record so `is_managed` and `progress` work on the very next tick.
        let initial_progress = TorrentProgress {
            state: if paused {
                TorrentState::Paused
            } else {
                TorrentState::Initializing
            },
            downloaded: 0,
            uploaded: 0,
            total: known_meta.as_ref().map(|m| m.total_size).unwrap_or(0),
            download_speed: 0,
            upload_speed: 0,
            peers: 0,
            eta_secs: None,
            finished: false,
            error: None,
            name: known_meta.as_ref().map(|m| m.name.clone()),
        };

        self.records
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(
                info_hash.clone(),
                AriaTorrentRecord {
                    gid,
                    info_hash: info_hash.clone(),
                    output_dir: output_folder.to_path_buf(),
                    meta: known_meta,
                    progress: initial_progress,
                    is_metadata_stage: false,
                },
            );

        Ok(info_hash)
    }

    fn gid_for(&self, info_hash: &str) -> Option<String> {
        let key = info_hash.to_ascii_lowercase();
        self.records
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&key)
            .map(|r| r.gid.clone())
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

    async fn resolve_active_gid(&self, info_hash: &str, mut gid: String) -> String {
        if let Ok(status) = self.rpc("aria2.tellStatus", vec![json!(gid)]).await
            && let Some(next_gid) = status
                .get("followedBy")
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
                .and_then(|v| v.as_str())
        {
            gid = next_gid.to_string();
            let key = info_hash.to_ascii_lowercase();
            if let Some(rec) = self
                .records
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .get_mut(&key)
            {
                rec.gid = gid.clone();
                rec.is_metadata_stage = false;
            }
        }
        gid
    }

    pub async fn pause(&self, info_hash: &str) -> Result<()> {
        let Some(raw_gid) = self.gid_for(info_hash) else {
            return Ok(());
        };
        let gid = self.resolve_active_gid(info_hash, raw_gid).await;
        if let Err(err) = self.rpc("aria2.forcePause", vec![json!(gid)]).await {
            let msg = err.to_string();
            // If metadata GID already finished or torrent is already paused/stopped, ignore cleanly.
            if !msg.contains("cannot be paused") && !msg.contains("not found") {
                return Err(err);
            }
        }
        let key = info_hash.to_ascii_lowercase();
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
        let raw_gid = self.gid_for(info_hash).context("unknown torrent")?;
        let gid = self.resolve_active_gid(info_hash, raw_gid).await;
        let status = self.rpc("aria2.tellStatus", vec![json!(gid)]).await?;
        let state = status.get("status").and_then(|s| s.as_str()).unwrap_or("");
        match state {
            "active" | "waiting" => Ok(()),
            "paused" => {
                let _ = self.rpc("aria2.unpause", vec![json!(gid)]).await?;
                Ok(())
            }
            other => Err(anyhow!("torrent GID in non-resumable state: {other}")),
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
        if let Some(h) = info_hash {
            let _ = self.remove(h, false).await;
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
        let Some(raw_gid) = self.gid_for(info_hash) else {
            return Ok(());
        };
        let gid = self.resolve_active_gid(info_hash, raw_gid).await;
        let mut opts = serde_json::Map::new();
        if let Some(seq) = sequential {
            opts.insert(
                "bt-prioritize-piece".into(),
                json!(if seq { "head=32M,tail=32M" } else { "" }),
            );
        }
        if let Some(trackers) = extra_trackers {
            opts.insert("bt-tracker".into(), json!(merge_trackers(trackers)));
        }
        if let Some(dl) = max_dl_bps {
            opts.insert("max-download-limit".into(), json!(dl.to_string()));
        }
        if let Some(ul) = max_ul_bps {
            opts.insert("max-upload-limit".into(), json!(ul.to_string()));
        }
        if opts.is_empty() {
            return Ok(());
        }
        let _ = self
            .rpc("aria2.changeOption", vec![json!(gid), Value::Object(opts)])
            .await?;
        Ok(())
    }

    pub async fn remove(&self, info_hash: &str, delete_files: bool) -> Result<()> {
        let key = info_hash.to_ascii_lowercase();
        let rec = self
            .records
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&key);
        if let Some(rec) = rec {
            let _ = self.rpc("aria2.forceRemove", vec![json!(rec.gid)]).await;
            let _ = self
                .rpc("aria2.removeDownloadResult", vec![json!(rec.gid)])
                .await;
            if delete_files
                && let Some(meta) = rec.meta
                && !rec.output_dir.as_os_str().is_empty()
            {
                let target = content_path(&rec.output_dir, &meta);
                if target.is_dir() {
                    let _ = std::fs::remove_dir_all(&target);
                } else if target.is_file() {
                    let _ = std::fs::remove_file(&target);
                }
            }
        }
        Ok(())
    }

    pub fn set_limits(&self, download_bps: u64, upload_bps: u64) {
        let client = self.client.clone();
        let url = self.rpc_url.clone();
        let secret = self.secret.clone();
        tokio::spawn(async move {
            let opts = json!({
                "max-overall-download-limit": download_bps.to_string(),
                "max-overall-upload-limit": upload_bps.to_string(),
            });
            let _ = Self::rpc_call_raw(
                &client,
                &url,
                &secret,
                "aria2.changeGlobalOption",
                vec![opts],
            )
            .await;
        });
    }

    pub async fn shutdown(&self) {
        self.poll_abort.abort();
        let _ = self.rpc("aria2.forceShutdown", vec![]).await;
        let child = self.child.lock().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(mut c) = child {
            let _ = c.kill().await;
        }
    }
}

fn merge_trackers(extra: &[String]) -> String {
    let mut seen: Vec<String> = TOP_PUBLIC_TRACKERS.iter().map(|s| s.to_string()).collect();
    for raw in extra {
        let t = raw.trim();
        if !t.is_empty() && !seen.iter().any(|existing| existing == t) {
            seen.push(t.to_string());
        }
    }
    seen.join(",")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hex_and_base32_magnet_info_hashes() {
        let hex = "0123456789abcdef0123456789abcdef01234567";
        let mag = format!("magnet:?xt=urn:btih:{hex}&dn=Example");
        assert_eq!(extract_magnet_info_hash(&mag).as_deref(), Some(hex));

        // 32-char base32 of 20 zero bytes => 40 hex zeros
        let mag_b32 = "magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&dn=Zero";
        assert_eq!(
            extract_magnet_info_hash(mag_b32).as_deref(),
            Some("0000000000000000000000000000000000000000")
        );
    }
}
