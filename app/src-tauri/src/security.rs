//! Selective malware guard: detects real harmful threats (infostealers,
//! ransomware, RATs, keyloggers, obfuscated script droppers, disguised double
//! extensions) while ignoring pure `HackTool` / `Crack` / `Keygen` / `PUA`
//! labels. Always advisory — HDM never auto-deletes user files.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_SCRIPT_READ_BYTES: u64 = 2 * 1024 * 1024; // 2 MiB

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityFinding {
    pub severity: String, // "harmful" | "caution"
    pub category: String,
    pub source: String,
    pub title: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityScanReport {
    pub verdict: String, // "clean" | "caution" | "harmful"
    pub sha256: Option<String>,
    pub file_name: String,
    pub ignored_crack_labels: u32,
    pub checked_sources: Vec<String>,
    pub findings: Vec<SecurityFinding>,
    pub scanned_at: i64,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// High-confidence real malware keywords that are NEVER ignored even if
/// paired with generic prefixes.
const HIGH_RISK_MALWARE_KEYWORDS: &[(&str, &str)] = &[
    ("infostealer", "Infostealer"),
    ("stealer", "Infostealer"),
    ("lumma", "Infostealer"),
    ("redline", "Infostealer"),
    ("vidar", "Infostealer"),
    ("raccoon", "Infostealer"),
    ("agenttesla", "Infostealer"),
    ("formbook", "Infostealer"),
    ("lokibot", "Infostealer"),
    ("cryptostealer", "Infostealer"),
    ("clipper", "Crypto Clipper"),
    ("ransom", "Ransomware"),
    ("lockbit", "Ransomware"),
    ("blackcat", "Ransomware"),
    ("wannacry", "Ransomware"),
    ("ryuk", "Ransomware"),
    ("conti", "Ransomware"),
    ("keylog", "Keylogger"),
    ("spyware", "Spyware"),
    ("trojanspy", "Spyware"),
    ("asyncrat", "Remote Access Trojan (RAT)"),
    ("dcrat", "Remote Access Trojan (RAT)"),
    ("njrat", "Remote Access Trojan (RAT)"),
    ("remcos", "Remote Access Trojan (RAT)"),
    ("quasarrat", "Remote Access Trojan (RAT)"),
    ("darkcomet", "Remote Access Trojan (RAT)"),
    ("rat.", "Remote Access Trojan (RAT)"),
    (".rat", "Remote Access Trojan (RAT)"),
    ("backdoor", "Backdoor"),
    ("rootkit", "Rootkit"),
    ("banker", "Banking Trojan"),
    ("cobaltstrike", "C2 Implant"),
    ("meterpreter", "C2 Implant"),
];

/// Labels typical of harmless game cracks, patchers, keygens, and trainers.
const BENIGN_CRACK_KEYWORDS: &[&str] = &[
    "hacktool",
    "crack",
    "keygen",
    "patcher",
    "gamehack",
    "cheatengine",
    "trainer",
    "pua",
    "pup",
    "riskware",
    "not-a-virus",
    "unwanted",
    "activator",
    "kms",
    "keygen",
    "warez",
];

/// Broader malware labels (used when multiple engines agree, never a single noisy hit).
const GENERAL_MALWARE_KEYWORDS: &[(&str, &str)] = &[
    ("trojan", "Trojan"),
    ("dropper", "Dropper"),
    ("downloader", "Malware Downloader"),
    ("worm", "Worm"),
    ("coinminer", "Cryptominer"),
    ("miner", "Cryptominer"),
    ("bot", "Botnet"),
    ("exploit", "Exploit"),
    ("shellcode", "Shellcode"),
    ("malware", "Malware"),
];

#[derive(Debug, PartialEq, Eq)]
enum LabelClass {
    HighRisk(&'static str),
    IgnoredCrack,
    GeneralMalware(&'static str),
    Unknown,
}

fn classify_av_label(raw: &str) -> LabelClass {
    let lower = raw.to_ascii_lowercase();
    for (kw, cat) in HIGH_RISK_MALWARE_KEYWORDS {
        if lower.contains(kw) {
            return LabelClass::HighRisk(cat);
        }
    }
    for kw in BENIGN_CRACK_KEYWORDS {
        if lower.contains(kw) {
            return LabelClass::IgnoredCrack;
        }
    }
    for (kw, cat) in GENERAL_MALWARE_KEYWORDS {
        if lower.contains(kw) {
            return LabelClass::GeneralMalware(cat);
        }
    }
    LabelClass::Unknown
}

const DECOY_EXTENSIONS: &[&str] = &[
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "jpg", "jpeg", "png",
    "gif", "webp", "bmp", "mp4", "mkv", "avi", "mov", "mp3", "wav", "flac", "zip", "rar", "7z",
    "iso",
];

const EXEC_DROPPER_EXTENSIONS: &[&str] = &[
    "exe", "scr", "pif", "bat", "cmd", "vbs", "vbe", "js", "jse", "hta", "wsf", "ps1", "lnk",
    "com",
];

const CAUTION_DROPPER_EXTENSIONS: &[&str] = &["hta", "scr", "pif", "lnk", "vbs", "vbe", "jse", "wsf"];

fn inspect_filename_heuristics(name: &str) -> Vec<SecurityFinding> {
    let mut findings = Vec::new();
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return findings;
    }

    // 1. Unicode Right-to-Left Override spoofing (e.g., `invoice_gpj.exe` rendered as `invoice_exe.jpg`)
    if trimmed.contains('\u{202E}') || trimmed.contains('\u{202D}') || trimmed.contains('\u{2066}') {
        findings.push(SecurityFinding {
            severity: "harmful".into(),
            category: "Filename Spoofing".into(),
            source: "Local Heuristics".into(),
            title: "Hidden Unicode direction-override character".into(),
            detail: "The filename uses Unicode BiDi override characters commonly used to disguise an executable as a harmless document or image.".into(),
        });
    }

    let lower = trimmed.to_ascii_lowercase();
    let parts: Vec<&str> = lower.split('.').filter(|p| !p.is_empty()).collect();
    if parts.len() >= 3 {
        let last = parts[parts.len() - 1];
        let prev = parts[parts.len() - 2];
        if DECOY_EXTENSIONS.contains(&prev) && EXEC_DROPPER_EXTENSIONS.contains(&last) {
            findings.push(SecurityFinding {
                severity: "harmful".into(),
                category: "Disguised Executable".into(),
                source: "Local Heuristics".into(),
                title: format!("Disguised double extension (.{prev}.{last})"),
                detail: format!(
                    "'{trimmed}' pretends to be a .{prev} file but is actually an executable/script (.{last}) — a common infostealer delivery trick."
                ),
            });
            return findings;
        }
    }

    if let Some(ext) = parts.last().copied() {
        if parts.len() >= 2 && CAUTION_DROPPER_EXTENSIONS.contains(&ext) {
            findings.push(SecurityFinding {
                severity: "caution".into(),
                category: "Script Dropper Type".into(),
                source: "Local Heuristics".into(),
                title: format!("High-risk script/shortcut file (.{ext})"),
                detail: format!(
                    "Files ending in .{ext} can execute arbitrary Windows commands immediately on double-click and are rarely used by legitimate installers or game cracks."
                ),
            });
        }
    }

    findings
}

const SCRIPT_SCAN_EXTENSIONS: &[&str] = &[
    "ps1", "bat", "cmd", "vbs", "vbe", "js", "jse", "hta", "wsf", "py",
];

fn inspect_script_content(path: &Path) -> Vec<SecurityFinding> {
    let mut findings = Vec::new();
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    if !SCRIPT_SCAN_EXTENSIONS.contains(&ext.as_str()) {
        return findings;
    }

    let Ok(meta) = std::fs::metadata(path) else {
        return findings;
    };
    if meta.len() == 0 || meta.len() > MAX_SCRIPT_READ_BYTES {
        return findings;
    }

    let Ok(bytes) = std::fs::read(path) else {
        return findings;
    };
    let text = String::from_utf8_lossy(&bytes).to_ascii_lowercase();

    // Ransomware recovery / shadow-copy destruction
    let ransom_hits = [
        "vssadmin delete shadows",
        "vssadmin.exe delete shadows",
        "wmic shadowcopy delete",
        "wbadmin delete catalog",
        "bcdedit /set {default} recoveryenabled no",
        "bcdedit /set {default} bootstatuspolicy ignoreallfailures",
    ]
    .iter()
    .filter(|pat| text.contains(**pat))
    .count();

    if ransom_hits > 0 {
        findings.push(SecurityFinding {
            severity: "harmful".into(),
            category: "Ransomware Behavior".into(),
            source: "Local Heuristics".into(),
            title: "Attempts to delete Windows shadow copies / backups".into(),
            detail: "This script contains commands used by ransomware to wipe System Restore / Volume Shadow Copies before encrypting files.".into(),
        });
    }

    // Browser password / cookie / crypto wallet / Discord / Telegram theft
    let stealer_indicators: Vec<&str> = [
        "google\\chrome\\user data",
        "login data",
        "local state",
        "exodus\\exodus.wallet",
        "electrum\\wallets",
        "metamask",
        "discord\\local storage\\leveldb",
        "telegram desktop\\tdata",
        "cryptunprotectdata",
    ]
    .iter()
    .copied()
    .filter(|pat| text.contains(*pat))
    .collect();

    if stealer_indicators.len() >= 2
        || stealer_indicators.iter().any(|k| {
            *k == "exodus\\exodus.wallet"
                || *k == "electrum\\wallets"
                || *k == "discord\\local storage\\leveldb"
                || *k == "telegram desktop\\tdata"
                || *k == "cryptunprotectdata"
        })
    {
        findings.push(SecurityFinding {
            severity: "harmful".into(),
            category: "Infostealer Indicators".into(),
            source: "Local Heuristics".into(),
            title: "References browser credentials, crypto wallets, or session tokens".into(),
            detail: format!(
                "Matched sensitive data paths/APIs: {}.",
                stealer_indicators.join(", ")
            ),
        });
    }

    // Encoded PowerShell / remote download-and-execute cradle
    let has_encoded_ps = text.contains("-encodedcommand")
        || text.contains(" -enc ")
        || (text.contains("frombase64string")
            && (text.contains("invoke-expression") || text.contains("iex")));
    let has_download_cradle = (text.contains("downloadstring(") || text.contains("invoke-webrequest"))
        && (text.contains("invoke-expression") || text.contains("iex ") || text.contains("| iex"))
        || text.contains("mshta http")
        || text.contains("certutil -urlcache");

    if has_encoded_ps || has_download_cradle {
        findings.push(SecurityFinding {
            severity: "harmful".into(),
            category: "Obfuscated Dropper".into(),
            source: "Local Heuristics".into(),
            title: "Obfuscated script / remote payload execution cradle".into(),
            detail: "This script downloads or decodes hidden code and executes it directly in memory — a hallmark of infostealer droppers.".into(),
        });
    }

    findings
}

fn sha256_file_sync(path: &Path) -> Result<String, String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|e| format!("cannot open file: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("read error while hashing: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    Ok(digest.iter().map(|b| format!("{b:02x}")).collect())
}

async fn query_malware_bazaar(
    client: &reqwest::Client,
    sha256: &str,
) -> Option<SecurityFinding> {
    let resp = client
        .post("https://mb-api.abuse.ch/api/v1/")
        .form(&[("query", "get_info"), ("hash", sha256)])
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let json: serde_json::Value = resp.json().await.ok()?;
    if json.get("query_status").and_then(|v| v.as_str()) != Some("ok") {
        return None;
    }
    let entry = json.get("data")?.as_array()?.first()?;
    let signature = entry
        .get("signature")
        .and_then(|v| v.as_str())
        .unwrap_or("Known Malware");
    let tags: Vec<&str> = entry
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|t| t.as_str()).collect())
        .unwrap_or_default();

    let tag_text = if tags.is_empty() {
        String::new()
    } else {
        format!(" Tags: {}.", tags.join(", "))
    };

    Some(SecurityFinding {
        severity: "harmful".into(),
        category: "Known Malware Family".into(),
        source: "MalwareBazaar (abuse.ch)".into(),
        title: format!("Confirmed malware hash: {signature}"),
        detail: format!(
            "SHA-256 matches an active malware sample tracked by abuse.ch MalwareBazaar.{tag_text}"
        ),
    })
}

struct VtEvaluation {
    findings: Vec<SecurityFinding>,
    ignored_cracks: u32,
}

fn evaluate_virustotal_results(results: &serde_json::Map<String, serde_json::Value>) -> VtEvaluation {
    let mut high_risk: Vec<(&'static str, String)> = Vec::new();
    let mut general_malware: Vec<(&'static str, String)> = Vec::new();
    let mut ignored_cracks: u32 = 0;

    for (engine, entry) in results {
        let category = entry
            .get("category")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if category != "malicious" && category != "suspicious" {
            continue;
        }
        let Some(label) = entry.get("result").and_then(|v| v.as_str()) else {
            continue;
        };
        match classify_av_label(label) {
            LabelClass::HighRisk(cat) => high_risk.push((cat, format!("{engine}: {label}"))),
            LabelClass::IgnoredCrack => ignored_cracks += 1,
            LabelClass::GeneralMalware(cat) => {
                general_malware.push((cat, format!("{engine}: {label}")))
            }
            LabelClass::Unknown => {}
        }
    }

    let mut findings = Vec::new();
    if !high_risk.is_empty() {
        let primary_cat = high_risk[0].0;
        let sample_labels: Vec<String> = high_risk.iter().take(3).map(|(_, s)| s.clone()).collect();
        findings.push(SecurityFinding {
            severity: "harmful".into(),
            category: primary_cat.into(),
            source: "VirusTotal (Filtered)".into(),
            title: format!(
                "{} engine(s) flagged real {primary_cat}",
                high_risk.len()
            ),
            detail: format!("Detections: {}", sample_labels.join(" · ")),
        });
    } else if general_malware.len() >= 3 {
        let primary_cat = general_malware[0].0;
        let sample_labels: Vec<String> = general_malware
            .iter()
            .take(3)
            .map(|(_, s)| s.clone())
            .collect();
        findings.push(SecurityFinding {
            severity: "harmful".into(),
            category: primary_cat.into(),
            source: "VirusTotal (Filtered)".into(),
            title: format!(
                "{} engines flagged non-crack malware ({primary_cat})",
                general_malware.len()
            ),
            detail: format!("Detections: {}", sample_labels.join(" · ")),
        });
    }

    VtEvaluation {
        findings,
        ignored_cracks,
    }
}

async fn query_virustotal(
    client: &reqwest::Client,
    sha256: &str,
    api_key: &str,
) -> Option<VtEvaluation> {
    let url = format!("https://www.virustotal.com/api/v3/files/{sha256}");
    let resp = client
        .get(&url)
        .header("x-apikey", api_key.trim())
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let json: serde_json::Value = resp.json().await.ok()?;
    let results = json
        .get("data")?
        .get("attributes")?
        .get("last_analysis_results")?
        .as_object()?;
    Some(evaluate_virustotal_results(results))
}

fn finalize_verdict(findings: &[SecurityFinding]) -> String {
    if findings.iter().any(|f| f.severity == "harmful") {
        "harmful".into()
    } else if !findings.is_empty() {
        "caution".into()
    } else {
        "clean".into()
    }
}

fn file_name_from_url(raw_url: &str) -> String {
    if let Ok(parsed) = url::Url::parse(raw_url) {
        if let Some(seg) = parsed.path_segments().and_then(|mut s| s.next_back()) {
            let decoded = percent_encoding::percent_decode_str(seg)
                .decode_utf8_lossy()
                .trim()
                .to_string();
            if !decoded.is_empty() {
                return decoded;
            }
        }
    }
    String::new()
}

/// Fast pre-download advisory check on URL & target filename.
#[tauri::command]
pub async fn scan_download_url(
    url: String,
    file_name: Option<String>,
) -> Result<SecurityScanReport, String> {
    let resolved_name = file_name
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| file_name_from_url(&url));

    let findings = inspect_filename_heuristics(&resolved_name);
    let verdict = finalize_verdict(&findings);

    Ok(SecurityScanReport {
        verdict,
        sha256: None,
        file_name: resolved_name,
        ignored_crack_labels: 0,
        checked_sources: vec!["Local Heuristics".into()],
        findings,
        scanned_at: now_ms(),
    })
}

/// Post-download / on-demand file scan:
/// 1. Local filename & script-content heuristics (offline, instant)
/// 2. SHA-256 lookup against abuse.ch MalwareBazaar (free, no key, real malware only)
/// 3. Optional SHA-256 lookup against VirusTotal (ignores pure HackTool/Crack/PUA labels)
#[tauri::command]
pub async fn scan_downloaded_file(
    path: String,
    vt_api_key: Option<String>,
) -> Result<SecurityScanReport, String> {
    let file_path = Path::new(&path).to_path_buf();
    if !file_path.exists() {
        return Err("File no longer exists on disk".into());
    }
    if file_path.is_dir() {
        return Err("Select an individual file to scan".into());
    }

    let file_name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    // Run local static heuristics + SHA-256 on blocking thread pool.
    let path_for_blocking = file_path.clone();
    let name_for_blocking = file_name.clone();
    let (sha256, mut findings) = tokio::task::spawn_blocking(move || {
        let mut local = inspect_filename_heuristics(&name_for_blocking);
        local.extend(inspect_script_content(&path_for_blocking));
        let digest = sha256_file_sync(&path_for_blocking)?;
        Ok::<(String, Vec<SecurityFinding>), String>((digest, local))
    })
    .await
    .map_err(|e| format!("scan worker failed: {e}"))??;

    let mut checked_sources = vec!["Local Heuristics".to_string()];
    let mut ignored_crack_labels: u32 = 0;

    if let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("HDM-SecurityGuard/1.0")
        .build()
    {
        checked_sources.push("MalwareBazaar".to_string());
        if let Some(mb_hit) = query_malware_bazaar(&client, &sha256).await {
            findings.push(mb_hit);
        }

        if let Some(key) = vt_api_key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
            checked_sources.push("VirusTotal (Filtered)".to_string());
            if let Some(vt_eval) = query_virustotal(&client, &sha256, key).await {
                ignored_crack_labels += vt_eval.ignored_cracks;
                findings.extend(vt_eval.findings);
            }
        }
    }

    let verdict = finalize_verdict(&findings);

    Ok(SecurityScanReport {
        verdict,
        sha256: Some(sha256),
        file_name,
        ignored_crack_labels,
        checked_sources,
        findings,
        scanned_at: now_ms(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ignores_pure_game_crack_labels_in_virustotal() {
        let results = json!({
            "Microsoft": { "category": "malicious", "result": "HackTool:Win32/Crack!MTB" },
            "ESET-NOD32": { "category": "malicious", "result": "Win32/Riskware.Keygen.A" },
            "Malwarebytes": { "category": "malicious", "result": "PUP.Optional.GameHack" },
            "Kaspersky": { "category": "malicious", "result": "not-a-virus:RiskTool.Win32.Patcher" }
        });
        let eval = evaluate_virustotal_results(results.as_object().unwrap());
        assert!(eval.findings.is_empty(), "game cracks must not be flagged");
        assert_eq!(eval.ignored_cracks, 4);
    }

    #[test]
    fn flags_real_stealer_and_ransomware_even_if_mixed_with_crack_labels() {
        let results = json!({
            "Microsoft": { "category": "malicious", "result": "TrojanSpy:Win32/LummaStealer!MTB" },
            "BitDefender": { "category": "malicious", "result": "HackTool.Crack.Generic" }
        });
        let eval = evaluate_virustotal_results(results.as_object().unwrap());
        assert_eq!(eval.findings.len(), 1);
        assert_eq!(eval.findings[0].severity, "harmful");
        assert_eq!(eval.findings[0].category, "Infostealer");
        assert_eq!(eval.ignored_cracks, 1);
    }

    #[test]
    fn flags_disguised_double_extension_but_not_normal_setup_exe() {
        let bad = inspect_filename_heuristics("The_Last_Of_Us_Gameplay.mp4.exe");
        assert_eq!(finalize_verdict(&bad), "harmful");

        let ok_setup = inspect_filename_heuristics("setup.exe");
        assert_eq!(finalize_verdict(&ok_setup), "clean");

        let ok_dll = inspect_filename_heuristics("steam_api64.dll");
        assert_eq!(finalize_verdict(&ok_dll), "clean");
    }

    #[test]
    fn detects_malicious_stealer_and_ransomware_scripts() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("install.ps1");
        std::fs::write(
            &script,
            "vssadmin delete shadows /all /quiet\n$p = '$env:LOCALAPPDATA\\Google\\Chrome\\User Data\\Default\\Login Data'\n",
        )
        .unwrap();
        let findings = inspect_script_content(&script);
        assert_eq!(finalize_verdict(&findings), "harmful");
        assert!(findings.iter().any(|f| f.category == "Ransomware Behavior"));
        assert!(findings.iter().any(|f| f.category == "Infostealer Indicators"));
    }
}
