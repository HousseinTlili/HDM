//! In-app Ollama model search, OCI manifest inspection, accelerated multi-segment
//! GGUF download, and local Ollama daemon integration.

use crate::commands::CmdResult;
use prism_core::manager::{Core, NewItem, StartMode};
use prism_core::settings::ConflictAction;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::Duration;
use tauri::State;

const OLLAMA_SITE: &str = "https://ollama.com";
const OLLAMA_REGISTRY: &str = "https://registry.ollama.ai";
const OLLAMA_LOCAL_DEFAULT: &str = "http://127.0.0.1:11434";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) HDM/0.1";

const OCI_ACCEPT: &str =
    "application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json";
const MODEL_MEDIA_TYPE: &str = "application/vnd.ollama.image.model";
const PROJECTOR_MEDIA_TYPE: &str = "application/vnd.ollama.image.projector";
const TEMPLATE_MEDIA_TYPE: &str = "application/vnd.ollama.image.template";
const SYSTEM_MEDIA_TYPE: &str = "application/vnd.ollama.image.system";

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModelSummary {
    pub name: String,
    pub description: String,
    pub pulls: Option<String>,
    pub capabilities: Vec<String>,
    pub sizes: Vec<String>,
    pub category: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OllamaTagInfo {
    pub tag: String,
    pub size_label: Option<String>,
    pub context: Option<String>,
    pub updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OllamaManifestInfo {
    pub model: String,
    pub tag: String,
    pub full_ref: String,
    pub model_digest: String,
    pub model_size: u64,
    pub total_size: u64,
    pub blob_url: String,
    pub file_name: String,
    pub has_template: bool,
    pub has_system: bool,
    pub has_projector: bool,
    pub projector_digest: Option<String>,
    pub projector_size: Option<u64>,
    pub default_folder: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OllamaLocalModel {
    pub name: String,
    pub size: u64,
    pub parameter_size: Option<String>,
    pub quantization: Option<String>,
    pub family: Option<String>,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OllamaLocalStatus {
    pub running: bool,
    pub endpoint: String,
    pub models_dir: Option<String>,
    pub models: Vec<OllamaLocalModel>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaDownloadArgs {
    pub model: String,
    pub tag: String,
    pub save_dir: Option<PathBuf>,
    pub mode: Option<StartMode>,
    pub write_modelfile: Option<bool>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OllamaDownloadResult {
    pub item_id: String,
    pub file_name: String,
    pub save_dir: String,
    pub modelfile_path: Option<String>,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SystemHardwareInfo {
    pub total_ram_bytes: u64,
    pub available_ram_bytes: u64,
    pub gpu_name: Option<String>,
    pub gpu_vram_bytes: Option<u64>,
    pub vram_source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalGgufFile {
    pub name: String,
    pub path: String,
    pub dir: String,
    pub size: u64,
    pub modified_ms: u64,
    pub source: String,
}

struct CuratedModel {
    name: &'static str,
    description: &'static str,
    pulls: &'static str,
    category: &'static str,
    capabilities: &'static [&'static str],
    sizes: &'static [&'static str],
}

const CURATED_CATALOG: &[CuratedModel] = &[
    CuratedModel {
        name: "llama3.3",
        description: "Meta Llama 3.3 70B flagship instruction-tuned model with strong tool use and reasoning.",
        pulls: "3.2M",
        category: "general",
        capabilities: &["tools"],
        sizes: &["70b"],
    },
    CuratedModel {
        name: "llama3.2",
        description: "Lightweight Meta Llama 3.2 1B and 3B multilingual text models optimized for edge devices.",
        pulls: "18.4M",
        category: "general",
        capabilities: &["tools"],
        sizes: &["1b", "3b"],
    },
    CuratedModel {
        name: "llama3.1",
        description: "Meta Llama 3.1 multilingual 8B, 70B, and 405B general-purpose models.",
        pulls: "42.1M",
        category: "general",
        capabilities: &["tools"],
        sizes: &["8b", "70b", "405b"],
    },
    CuratedModel {
        name: "qwen3",
        description: "Alibaba Qwen3 family featuring hybrid thinking mode, strong coding, and tool calling.",
        pulls: "5.4M",
        category: "reasoning",
        capabilities: &["thinking", "tools"],
        sizes: &["0.6b", "1.7b", "4b", "8b", "14b", "30b", "32b"],
    },
    CuratedModel {
        name: "qwen2.5",
        description: "Qwen 2.5 general-purpose dense models with strong structured JSON output and multilingual skills.",
        pulls: "14.2M",
        category: "general",
        capabilities: &["tools"],
        sizes: &["0.5b", "1.5b", "3b", "7b", "14b", "32b", "72b"],
    },
    CuratedModel {
        name: "qwen2.5-coder",
        description: "Code-specialized Qwen 2.5 models for generation, debugging, and repository completion.",
        pulls: "9.8M",
        category: "coding",
        capabilities: &["tools"],
        sizes: &["0.5b", "1.5b", "3b", "7b", "14b", "32b"],
    },
    CuratedModel {
        name: "deepseek-r1",
        description: "DeepSeek-R1 open reasoning models with verifiable chain-of-thought performance.",
        pulls: "29.6M",
        category: "reasoning",
        capabilities: &["thinking"],
        sizes: &["1.5b", "7b", "8b", "14b", "32b", "70b"],
    },
    CuratedModel {
        name: "deepseek-v3",
        description: "DeepSeek-V3 mixture-of-experts model built for fast general reasoning and coding.",
        pulls: "2.1M",
        category: "general",
        capabilities: &["tools"],
        sizes: &["671b"],
    },
    CuratedModel {
        name: "gemma3",
        description: "Google Gemma 3 multimodal and long-context models from 1B to 27B parameters.",
        pulls: "8.9M",
        category: "vision",
        capabilities: &["vision"],
        sizes: &["1b", "4b", "12b", "27b"],
    },
    CuratedModel {
        name: "gemma2",
        description: "Google Gemma 2 high-efficiency 2B, 9B, and 27B open weights models.",
        pulls: "11.5M",
        category: "general",
        capabilities: &[],
        sizes: &["2b", "9b", "27b"],
    },
    CuratedModel {
        name: "phi4",
        description: "Microsoft Phi-4 14B reasoning-focused compact language model.",
        pulls: "3.7M",
        category: "reasoning",
        capabilities: &[],
        sizes: &["14b"],
    },
    CuratedModel {
        name: "phi4-mini",
        description: "Microsoft Phi-4 Mini 3.8B compact model with function calling support.",
        pulls: "1.4M",
        category: "general",
        capabilities: &["tools"],
        sizes: &["3.8b"],
    },
    CuratedModel {
        name: "mistral",
        description: "Mistral 7B v0.3 versatile open weights instruction model.",
        pulls: "21.0M",
        category: "general",
        capabilities: &["tools"],
        sizes: &["7b"],
    },
    CuratedModel {
        name: "mistral-nemo",
        description: "Mistral Nemo 12B model built in collaboration with NVIDIA with 128k context.",
        pulls: "4.3M",
        category: "general",
        capabilities: &["tools"],
        sizes: &["12b"],
    },
    CuratedModel {
        name: "codestral",
        description: "Mistral Codestral 22B model engineered specifically for software development.",
        pulls: "2.6M",
        category: "coding",
        capabilities: &[],
        sizes: &["22b"],
    },
    CuratedModel {
        name: "mixtral",
        description: "Mistral Mixture-of-Experts 8x7B and 8x22B sparse high-throughput models.",
        pulls: "7.8M",
        category: "general",
        capabilities: &["tools"],
        sizes: &["8x7b", "8x22b"],
    },
    CuratedModel {
        name: "qwq",
        description: "Qwen QwQ-32B specialized reasoning model for math, logic, and complex synthesis.",
        pulls: "1.9M",
        category: "reasoning",
        capabilities: &["thinking", "tools"],
        sizes: &["32b"],
    },
    CuratedModel {
        name: "command-r",
        description: "Cohere Command R 35B model tuned for RAG, citation, and enterprise tool use.",
        pulls: "1.3M",
        category: "general",
        capabilities: &["tools"],
        sizes: &["35b"],
    },
    CuratedModel {
        name: "nomic-embed-text",
        description: "High-performing open embedding model with large 8k token context window.",
        pulls: "24.5M",
        category: "embedding",
        capabilities: &["embedding"],
        sizes: &["latest"],
    },
    CuratedModel {
        name: "mxbai-embed-large",
        description: "Mixedbread AI state-of-the-art sentence embedding model for semantic search.",
        pulls: "6.4M",
        category: "embedding",
        capabilities: &["embedding"],
        sizes: &["335m"],
    },
    CuratedModel {
        name: "bge-m3",
        description: "BAAI BGE-M3 multilingual, multi-granularity dense + sparse embedding model.",
        pulls: "2.9M",
        category: "embedding",
        capabilities: &["embedding"],
        sizes: &["567m"],
    },
    CuratedModel {
        name: "llava",
        description: "LLaVA multimodal vision-language model supporting image analysis and OCR.",
        pulls: "8.1M",
        category: "vision",
        capabilities: &["vision"],
        sizes: &["7b", "13b", "34b"],
    },
    CuratedModel {
        name: "llama3.2-vision",
        description: "Meta Llama 3.2 Vision 11B and 90B image-reasoning models.",
        pulls: "4.6M",
        category: "vision",
        capabilities: &["vision"],
        sizes: &["11b", "90b"],
    },
    CuratedModel {
        name: "minicpm-v",
        description: "Compact high-accuracy OpenBMB MiniCPM-V multimodal vision model.",
        pulls: "1.7M",
        category: "vision",
        capabilities: &["vision"],
        sizes: &["8b"],
    },
    CuratedModel {
        name: "granite3.2",
        description: "IBM Granite 3.2 2B/8B compact models with reasoning and tool calling.",
        pulls: "920K",
        category: "general",
        capabilities: &["tools", "thinking"],
        sizes: &["2b", "8b"],
    },
    CuratedModel {
        name: "starcoder2",
        description: "BigCode StarCoder2 open-source code generation models trained on 600+ languages.",
        pulls: "1.5M",
        category: "coding",
        capabilities: &[],
        sizes: &["3b", "7b", "15b"],
    },
    CuratedModel {
        name: "smollm2",
        description: "Hugging Face SmolLM2 ultra-lightweight 135M–1.7B on-device text models.",
        pulls: "1.2M",
        category: "general",
        capabilities: &[],
        sizes: &["135m", "360m", "1.7b"],
    },
    CuratedModel {
        name: "dolphin3",
        description: "Cognitive Computations Dolphin 3 Llama-3.1 8B uncensored coding and agent model.",
        pulls: "1.1M",
        category: "coding",
        capabilities: &["tools"],
        sizes: &["8b"],
    },
];

fn curated_summaries() -> Vec<OllamaModelSummary> {
    CURATED_CATALOG
        .iter()
        .map(|m| OllamaModelSummary {
            name: m.name.to_string(),
            description: m.description.to_string(),
            pulls: Some(m.pulls.to_string()),
            capabilities: m.capabilities.iter().map(|s| (*s).to_string()).collect(),
            sizes: m.sizes.iter().map(|s| (*s).to_string()).collect(),
            category: m.category.to_string(),
            source: "curated".into(),
        })
        .collect()
}

fn infer_category(name: &str, capabilities: &[String]) -> String {
    let lower = name.to_ascii_lowercase();
    if capabilities.iter().any(|c| c == "embedding") || lower.contains("embed") || lower.contains("bge")
    {
        return "embedding".into();
    }
    if capabilities.iter().any(|c| c == "vision")
        || lower.contains("vision")
        || lower.contains("llava")
        || lower.contains("moondream")
    {
        return "vision".into();
    }
    if lower.contains("coder")
        || lower.contains("codestral")
        || lower.contains("starcoder")
        || lower.contains("codellama")
        || lower.contains("devstral")
    {
        return "coding".into();
    }
    if capabilities.iter().any(|c| c == "thinking")
        || lower.contains("-r1")
        || lower.contains("qwq")
        || lower.contains("reasoning")
    {
        return "reasoning".into();
    }
    "general".into()
}

fn strip_html_tags(input: &str) -> String {
    static TAG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]+>").expect("tag regex"));
    let stripped = TAG_RE.replace_all(input, " ");
    stripped
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Normalize user input like `ollama.com/library/qwen2.5:7b` or `llama3.2:latest` into `(model, optional_tag)`.
pub(crate) fn normalize_model_ref(raw: &str) -> Result<(String, Option<String>), String> {
    let mut s = raw.trim().to_string();
    if let Some(rest) = s.strip_prefix("ollama://") {
        s = rest.to_string();
    } else if let Some(rest) = s.strip_prefix("ollama:") {
        s = rest.to_string();
    }
    if s.contains("://")
        && let Ok(url) = url::Url::parse(&s)
    {
        let mut segs: Vec<&str> = url
            .path_segments()
            .map(|iter| iter.filter(|p| !p.is_empty()).collect())
            .unwrap_or_default();
        if segs.first().copied() == Some("library") {
            segs.remove(0);
        }
        if !segs.is_empty() {
            let last = segs.last().copied().unwrap_or("");
            if last == "tags" && segs.len() >= 2 {
                segs.pop();
            }
            s = segs.join("/");
        }
    }
    let s = s.trim_matches('/');
    if s.is_empty() {
        return Err("Enter an Ollama model name (for example llama3.2 or qwen2.5-coder)".into());
    }
    let (model_part, tag_part) = match s.split_once(':') {
        Some((m, t)) => (
            m.trim(),
            Some(t.trim()).filter(|t| !t.is_empty()).map(str::to_string),
        ),
        None => (s, None),
    };
    let valid_char = |c: char| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/');
    if model_part.is_empty() || !model_part.chars().all(valid_char) || model_part.contains("..") {
        return Err(format!("Invalid Ollama model name: {model_part}"));
    }
    if let Some(t) = &tag_part
        && (!t.chars().all(|c| valid_char(c) && c != '/') || t.contains(".."))
    {
        return Err(format!("Invalid Ollama model tag: {t}"));
    }
    Ok((model_part.to_ascii_lowercase(), tag_part))
}

fn registry_repo_path(model: &str) -> String {
    if model.contains('/') {
        model.to_string()
    } else {
        format!("library/{model}")
    }
}

fn sanitize_filename_segment(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '-'
            }
        })
        .collect()
}

pub(crate) fn parse_ollama_search_html(html: &str) -> Vec<OllamaModelSummary> {
    static LINK_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"(?is)<a[^>]+href=["']/library/([a-z0-9._-]+)["'][^>]*>(.*?)</a>"#)
            .expect("search anchor regex")
    });
    static DESC_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"(?is)<p[^>]*>(.*?)</p>"#).expect("desc paragraph regex")
    });
    static PULLS_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"(?i)([0-9]+(?:\.[0-9]+)?[kmb]?)\s+Pulls"#).expect("pulls regex")
    });
    static SPAN_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"(?is)<span[^>]*>(.*?)</span>"#).expect("span badge regex")
    });
    static SIZE_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"(?i)^[0-9]+(?:\.[0-9]+)?[mb]$|^[0-9]+x[0-9]+[mb]$"#).expect("size regex")
    });

    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for cap in LINK_RE.captures_iter(html) {
        let name = cap[1].to_ascii_lowercase();
        if !seen.insert(name.clone()) {
            continue;
        }
        let body = &cap[2];
        let description = DESC_RE
            .captures(body)
            .map(|c| strip_html_tags(&c[1]))
            .filter(|d| !d.is_empty())
            .unwrap_or_else(|| format!("Ollama library model {name}"));

        let text_all = strip_html_tags(body);
        let pulls = PULLS_RE
            .captures(&text_all)
            .map(|c| c[1].to_ascii_uppercase());

        let mut sizes = Vec::new();
        let mut capabilities = Vec::new();
        for sc in SPAN_RE.captures_iter(body) {
            let token = strip_html_tags(&sc[1]).to_ascii_lowercase();
            if token.is_empty() || token.len() > 18 {
                continue;
            }
            if SIZE_RE.is_match(&token) && !sizes.contains(&token) {
                sizes.push(token);
            } else if matches!(token.as_str(), "tools" | "thinking" | "vision" | "embedding")
                && !capabilities.contains(&token)
            {
                capabilities.push(token);
            }
        }
        let category = infer_category(&name, &capabilities);
        out.push(OllamaModelSummary {
            name,
            description,
            pulls,
            capabilities,
            sizes,
            category,
            source: "live".into(),
        });
    }
    out
}

pub(crate) fn parse_ollama_tags_html(html: &str, model: &str) -> Vec<OllamaTagInfo> {
    let escaped = regex::escape(model);
    let pat = format!(r#"(?is)href=["']/library/{escaped}:([a-zA-Z0-9._-]+)["'][^>]*>.*?</a>"#);
    let Ok(anchor_re) = Regex::new(&pat) else {
        return Vec::new();
    };
    static SIZE_LABEL_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"(?i)\b([0-9]+(?:\.[0-9]+)?\s*(?:GB|MB|KB))\b"#).expect("tag size regex")
    });
    static CTX_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"(?i)\b([0-9]+K)\b"#).expect("ctx regex")
    });

    let mut tags = Vec::new();
    let mut seen = HashSet::new();
    for m in anchor_re.find_iter(html) {
        let snippet_end = (m.end() + 420).min(html.len());
        let block = &html[m.start()..snippet_end];
        let Some(cap) = anchor_re.captures(&html[m.start()..m.end()]) else {
            continue;
        };
        let tag = cap[1].to_string();
        if tag.eq_ignore_ascii_case("tags") || !seen.insert(tag.clone()) {
            continue;
        }
        let text = strip_html_tags(block);
        let size_label = SIZE_LABEL_RE
            .captures(&text)
            .map(|c| c[1].replace(' ', "").to_ascii_uppercase());
        let context = CTX_RE.captures(&text).map(|c| c[1].to_ascii_uppercase());
        tags.push(OllamaTagInfo {
            tag,
            size_label,
            context,
            updated: None,
        });
    }
    tags
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OciManifest {
    #[serde(default)]
    layers: Vec<OciLayer>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OciLayer {
    media_type: String,
    digest: String,
    #[serde(default)]
    size: u64,
}

pub(crate) fn parse_oci_manifest_json(
    bytes: &[u8],
    model: &str,
    tag: &str,
    default_folder: String,
) -> Result<OllamaManifestInfo, String> {
    let manifest: OciManifest = serde_json::from_slice(bytes)
        .map_err(|e| format!("Unexpected manifest format from Ollama registry: {e}"))?;
    let model_layer = manifest
        .layers
        .iter()
        .find(|l| l.media_type == MODEL_MEDIA_TYPE)
        .ok_or_else(|| {
            format!(
                "No GGUF weights layer found in manifest for {model}:{tag}. Verify the model and tag name."
            )
        })?;
    let projector_layer = manifest
        .layers
        .iter()
        .find(|l| l.media_type == PROJECTOR_MEDIA_TYPE);
    let has_template = manifest
        .layers
        .iter()
        .any(|l| l.media_type == TEMPLATE_MEDIA_TYPE);
    let has_system = manifest
        .layers
        .iter()
        .any(|l| l.media_type == SYSTEM_MEDIA_TYPE);

    let repo = registry_repo_path(model);
    let blob_url = format!("{OLLAMA_REGISTRY}/v2/{repo}/blobs/{}", model_layer.digest);
    let safe_model = sanitize_filename_segment(&model.replace('/', "-"));
    let safe_tag = sanitize_filename_segment(tag);
    let file_name = format!("{safe_model}-{safe_tag}.gguf");
    let total_size: u64 = manifest.layers.iter().map(|l| l.size).sum();

    Ok(OllamaManifestInfo {
        model: model.to_string(),
        tag: tag.to_string(),
        full_ref: format!("{model}:{tag}"),
        model_digest: model_layer.digest.clone(),
        model_size: model_layer.size,
        total_size: total_size.max(model_layer.size),
        blob_url,
        file_name,
        has_template,
        has_system,
        has_projector: projector_layer.is_some(),
        projector_digest: projector_layer.map(|p| p.digest.clone()),
        projector_size: projector_layer.map(|p| p.size),
        default_folder,
    })
}

fn ollama_http_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .tcp_nodelay(true)
        .user_agent(USER_AGENT)
        .build()
        .map_err(err)
}

fn default_ollama_save_dir(core: &Core, model: &str) -> PathBuf {
    let hf_folder = core.hf_context().folder;
    let base = if hf_folder.trim().is_empty() {
        core.settings().downloads.default_dir.join("Models")
    } else {
        PathBuf::from(hf_folder)
    };
    let mut out = base.join("Ollama");
    for seg in model.split('/') {
        out.push(sanitize_filename_segment(seg));
    }
    out
}

fn detect_ollama_models_dir() -> Option<String> {
    if let Some(custom) = std::env::var_os("OLLAMA_MODELS") {
        let p = PathBuf::from(custom);
        if p.exists() {
            return Some(p.to_string_lossy().into_owned());
        }
    }
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)?;
    let p = home.join(".ollama").join("models");
    p.exists().then(|| p.to_string_lossy().into_owned())
}

fn filter_summaries(
    items: Vec<OllamaModelSummary>,
    query: &str,
    category: Option<&str>,
) -> Vec<OllamaModelSummary> {
    let q = query.trim().to_ascii_lowercase();
    let q_model = q.split(':').next().unwrap_or("").trim();
    let cat_filter = category
        .map(str::trim)
        .filter(|c| !c.is_empty() && !c.eq_ignore_ascii_case("all"))
        .map(str::to_ascii_lowercase);

    items
        .into_iter()
        .filter(|m| {
            let cat_ok = cat_filter.as_ref().is_none_or(|c| m.category == *c);
            let q_ok = q_model.is_empty()
                || m.name.to_ascii_lowercase().contains(q_model)
                || m.description.to_ascii_lowercase().contains(q_model)
                || m.capabilities.iter().any(|cap| cap.contains(q_model));
            cat_ok && q_ok
        })
        .collect()
}

fn merge_search_results(
    live: Vec<OllamaModelSummary>,
    query: &str,
    category: Option<&str>,
) -> Vec<OllamaModelSummary> {
    let curated_by_name: HashMap<String, OllamaModelSummary> = curated_summaries()
        .into_iter()
        .map(|m| (m.name.clone(), m))
        .collect();

    let mut seen = HashSet::new();
    let mut merged = Vec::new();

    for mut item in live {
        if !seen.insert(item.name.clone()) {
            continue;
        }
        if let Some(cur) = curated_by_name.get(&item.name) {
            if item.description.starts_with("Ollama library model ") {
                item.description = cur.description.clone();
            }
            if item.sizes.is_empty() {
                item.sizes = cur.sizes.clone();
            }
            if item.capabilities.is_empty() {
                item.capabilities = cur.capabilities.clone();
            }
            item.category = cur.category.clone();
        }
        merged.push(item);
    }

    for cur in curated_summaries() {
        if seen.insert(cur.name.clone()) {
            merged.push(cur);
        }
    }

    filter_summaries(merged, query, category)
}

#[tauri::command]
pub async fn ollama_search(
    query: String,
    category: Option<String>,
) -> CmdResult<Vec<OllamaModelSummary>> {
    let trimmed_q = query.trim().to_string();
    let normalized_q = trimmed_q.split(':').next().unwrap_or("").trim().to_string();
    let cat = category.clone().unwrap_or_default();

    let url = if !normalized_q.is_empty() {
        let encoded =
            percent_encoding::utf8_percent_encode(&normalized_q, percent_encoding::NON_ALPHANUMERIC);
        format!("{OLLAMA_SITE}/search?q={encoded}")
    } else if !cat.trim().is_empty() && !cat.eq_ignore_ascii_case("all") {
        let encoded =
            percent_encoding::utf8_percent_encode(cat.trim(), percent_encoding::NON_ALPHANUMERIC);
        format!("{OLLAMA_SITE}/search?c={encoded}")
    } else {
        format!("{OLLAMA_SITE}/library")
    };

    let live = match ollama_http_client(6) {
        Ok(client) => match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => match resp.text().await {
                Ok(html) => parse_ollama_search_html(&html),
                Err(_) => Vec::new(),
            },
            _ => Vec::new(),
        },
        Err(_) => Vec::new(),
    };

    Ok(merge_search_results(
        live,
        &trimmed_q,
        category.as_deref(),
    ))
}

#[tauri::command]
pub async fn ollama_model_tags(model: String) -> CmdResult<Vec<OllamaTagInfo>> {
    let (clean_model, explicit_tag) = normalize_model_ref(&model)?;
    let url = format!("{OLLAMA_SITE}/library/{clean_model}/tags");
    let mut tags = match ollama_http_client(6) {
        Ok(client) => match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => match resp.text().await {
                Ok(html) => parse_ollama_tags_html(&html, &clean_model),
                Err(_) => Vec::new(),
            },
            _ => Vec::new(),
        },
        Err(_) => Vec::new(),
    };

    if tags.is_empty()
        && let Some(cur) = CURATED_CATALOG.iter().find(|m| m.name == clean_model)
    {
        for sz in cur.sizes {
            tags.push(OllamaTagInfo {
                tag: (*sz).to_string(),
                size_label: None,
                context: None,
                updated: None,
            });
        }
    }

    if let Some(t) = explicit_tag
        && !tags.iter().any(|x| x.tag == t)
    {
        tags.insert(
            0,
            OllamaTagInfo {
                tag: t,
                size_label: None,
                context: None,
                updated: None,
            },
        );
    }

    if !tags.iter().any(|x| x.tag == "latest") {
        tags.insert(
            0,
            OllamaTagInfo {
                tag: "latest".into(),
                size_label: None,
                context: None,
                updated: None,
            },
        );
    }

    Ok(tags)
}

async fn fetch_manifest_info(
    core: &Core,
    model: &str,
    tag: &str,
) -> Result<(OllamaManifestInfo, Option<String>), String> {
    let (clean_model, ref_tag) = normalize_model_ref(model)?;
    let chosen_tag = if tag.trim().is_empty() {
        ref_tag.unwrap_or_else(|| "latest".into())
    } else {
        tag.trim().to_string()
    };
    let repo = registry_repo_path(&clean_model);
    let url = format!("{OLLAMA_REGISTRY}/v2/{repo}/manifests/{chosen_tag}");

    let client = ollama_http_client(15)?;
    let resp = client
        .get(&url)
        .header(reqwest::header::ACCEPT, OCI_ACCEPT)
        .send()
        .await
        .map_err(|e| format!("Could not reach Ollama registry: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Ollama registry returned HTTP {} for {}:{}",
            resp.status().as_u16(),
            clean_model,
            chosen_tag
        ));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read Ollama manifest body: {e}"))?;

    let folder = default_ollama_save_dir(core, &clean_model)
        .to_string_lossy()
        .into_owned();
    let info = parse_oci_manifest_json(&bytes, &clean_model, &chosen_tag, folder)?;

    // Extract optional small template text best-effort so generated Modelfile is ready to import.
    let template_text = if info.has_template
        && let Ok(parsed) = serde_json::from_slice::<OciManifest>(&bytes)
        && let Some(tmpl_layer) = parsed
            .layers
            .iter()
            .find(|l| l.media_type == TEMPLATE_MEDIA_TYPE && l.size <= 256 * 1024)
    {
        let tmpl_url = format!("{OLLAMA_REGISTRY}/v2/{repo}/blobs/{}", tmpl_layer.digest);
        match tokio::time::timeout(Duration::from_secs(4), client.get(tmpl_url).send()).await {
            Ok(Ok(r)) if r.status().is_success() => r.text().await.ok(),
            _ => None,
        }
    } else {
        None
    };

    Ok((info, template_text))
}

#[tauri::command]
pub async fn ollama_inspect_manifest(
    core: State<'_, Core>,
    model: String,
    tag: String,
) -> CmdResult<OllamaManifestInfo> {
    let (info, _) = fetch_manifest_info(&core, &model, &tag).await?;
    Ok(info)
}

#[derive(Deserialize)]
struct LocalTagsResponse {
    #[serde(default)]
    models: Vec<LocalApiModel>,
}

#[derive(Deserialize)]
struct LocalApiModel {
    name: String,
    #[serde(default)]
    size: u64,
    modified_at: Option<String>,
    details: Option<LocalApiDetails>,
}

#[derive(Deserialize)]
struct LocalApiDetails {
    family: Option<String>,
    parameter_size: Option<String>,
    quantization_level: Option<String>,
}

#[tauri::command]
pub async fn ollama_local_status() -> CmdResult<OllamaLocalStatus> {
    let models_dir = detect_ollama_models_dir();
    let endpoint = OLLAMA_LOCAL_DEFAULT.to_string();
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_millis(1500))
        .build()
    {
        Ok(c) => c,
        Err(_) => {
            return Ok(OllamaLocalStatus {
                running: false,
                endpoint,
                models_dir,
                models: Vec::new(),
            });
        }
    };

    let url = format!("{endpoint}/api/tags");
    let Ok(resp) = client.get(url).send().await else {
        return Ok(OllamaLocalStatus {
            running: false,
            endpoint,
            models_dir,
            models: Vec::new(),
        });
    };
    if !resp.status().is_success() {
        return Ok(OllamaLocalStatus {
            running: false,
            endpoint,
            models_dir,
            models: Vec::new(),
        });
    }
    let parsed: LocalTagsResponse = resp.json().await.unwrap_or(LocalTagsResponse {
        models: Vec::new(),
    });
    let models = parsed
        .models
        .into_iter()
        .map(|m| {
            let details = m.details;
            OllamaLocalModel {
                name: m.name,
                size: m.size,
                parameter_size: details.as_ref().and_then(|d| d.parameter_size.clone()),
                quantization: details.as_ref().and_then(|d| d.quantization_level.clone()),
                family: details.and_then(|d| d.family),
                modified_at: m.modified_at,
            }
        })
        .collect();

    Ok(OllamaLocalStatus {
        running: true,
        endpoint,
        models_dir,
        models,
    })
}

fn sha256_hex_from_digest(digest: &str) -> Option<String> {
    let hex = digest.strip_prefix("sha256:")?.trim();
    (hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit()))
        .then(|| hex.to_ascii_lowercase())
}

#[tauri::command]
pub async fn ollama_download(
    core: State<'_, Core>,
    args: OllamaDownloadArgs,
) -> CmdResult<OllamaDownloadResult> {
    let (info, template_text) = fetch_manifest_info(&core, &args.model, &args.tag).await?;
    let sha_hex = sha256_hex_from_digest(&info.model_digest)
        .ok_or_else(|| format!("Unsupported digest in manifest: {}", info.model_digest))?;

    let save_dir = args
        .save_dir
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| PathBuf::from(&info.default_folder));

    std::fs::create_dir_all(&save_dir).map_err(err)?;

    let modelfile_path = if args.write_modelfile.unwrap_or(true) {
        let mf_path = save_dir.join("Modelfile");
        let mut content = format!("FROM ./{}\n", info.file_name);
        if let Some(tmpl) = template_text.filter(|t| !t.trim().is_empty()) {
            content.push_str(&format!("TEMPLATE \"\"\"{}\"\"\"\n", tmpl.replace("\"\"\"", "\\\"\\\"\\\"")));
        }
        if std::fs::write(&mf_path, content).is_ok() {
            Some(mf_path.to_string_lossy().into_owned())
        } else {
            None
        }
    } else {
        None
    };

    let item = NewItem {
        url: info.blob_url.clone(),
        file_name: Some(info.file_name.clone()),
        save_dir: Some(save_dir.clone()),
        category: Some(prism_core::categories::OTHER.to_string()),
        description: format!("{} · Ollama GGUF", info.full_ref),
        size: (info.model_size > 0).then_some(info.model_size),
        checksum: Some(format!("sha256:{sha_hex}")),
        conflict: Some(ConflictAction::Overwrite),
        ..Default::default()
    };

    let added = core
        .add_items(vec![item], args.mode.unwrap_or(StartMode::Now))
        .map_err(err)?;
    let created = added
        .into_iter()
        .next()
        .ok_or_else(|| "Failed to enqueue Ollama download".to_string())?;

    Ok(OllamaDownloadResult {
        item_id: created.id,
        file_name: info.file_name,
        save_dir: save_dir.to_string_lossy().into_owned(),
        modelfile_path,
        size: info.model_size,
        sha256: sha_hex,
    })
}

fn validate_ollama_import_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 96 {
        return Err("Enter a valid local Ollama model name (e.g. my-qwen:latest)".into());
    }
    let ok = trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ':' | '/'));
    if !ok || trimmed.contains("..") || trimmed.starts_with('-') || trimmed.starts_with('/') {
        return Err(format!("Unsafe model reference: {trimmed}"));
    }
    Ok(trimmed.to_ascii_lowercase())
}

#[tauri::command]
pub async fn ollama_import_gguf(model_ref: String, gguf_path: PathBuf) -> CmdResult<String> {
    let clean_ref = validate_ollama_import_name(&model_ref)?;
    if !gguf_path.is_file() {
        return Err(format!("GGUF file not found on disk: {}", gguf_path.display()));
    }

    let parent = gguf_path.parent().unwrap_or_else(|| Path::new("."));
    let sibling_modelfile = parent.join("Modelfile");
    let mut temp_modelfile: Option<PathBuf> = None;

    let modelfile_to_use = if sibling_modelfile.is_file()
        && let Ok(text) = std::fs::read_to_string(&sibling_modelfile)
        && let Some(fname) = gguf_path.file_name().and_then(|n| n.to_str())
        && text.contains(fname)
    {
        sibling_modelfile
    } else {
        let tmp = parent.join(".hdm-ollama.Modelfile");
        std::fs::write(&tmp, format!("FROM {}\n", gguf_path.display())).map_err(err)?;
        temp_modelfile = Some(tmp.clone());
        tmp
    };

    let mut cmd = tokio::process::Command::new("ollama");
    cmd.args(["create", &clean_ref, "-f"])
        .arg(&modelfile_to_use)
        .current_dir(parent)
        .stdin(std::process::Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);

    let output = cmd.output().await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Ollama CLI (`ollama`) was not found on PATH. Install Ollama or add it to PATH first."
                .to_string()
        } else {
            format!("Failed to launch ollama: {e}")
        }
    })?;

    if let Some(tmp) = temp_modelfile {
        let _ = std::fs::remove_file(tmp);
    }

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "ollama create failed: {}",
            if stderr.trim().is_empty() {
                stdout.trim()
            } else {
                stderr.trim()
            }
        ));
    }

    Ok(format!(
        "Imported `{clean_ref}` into local Ollama. Run `ollama run {clean_ref}` to start."
    ))
}

#[tauri::command]
pub async fn ollama_delete_local_model(name: String) -> CmdResult<String> {
    let clean = validate_ollama_import_name(&name)?;
    let client = ollama_http_client(10)?;
    let url = format!("{OLLAMA_LOCAL_DEFAULT}/api/delete");
    let resp = client
        .delete(url)
        .json(&serde_json::json!({ "name": clean }))
        .send()
        .await
        .map_err(|e| format!("Could not reach local Ollama daemon: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama returned HTTP {status}: {}", body.trim()));
    }
    Ok(format!("Removed `{clean}` from local Ollama."))
}

fn detect_ram_bytes() -> (u64, u64) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::SystemInformation::{
            GlobalMemoryStatusEx, MEMORYSTATUSEX,
        };
        let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
        status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        if unsafe { GlobalMemoryStatusEx(&mut status) } != 0 {
            return (status.ullTotalPhys, status.ullAvailPhys);
        }
        (0, 0)
    }
    #[cfg(target_os = "linux")]
    {
        let text = std::fs::read_to_string("/proc/meminfo").unwrap_or_default();
        let parse_kb = |key: &str| -> u64 {
            text.lines()
                .find_map(|line| {
                    let rest = line.strip_prefix(key)?;
                    let kb: u64 = rest.split_whitespace().next()?.parse().ok()?;
                    Some(kb.saturating_mul(1024))
                })
                .unwrap_or(0)
        };
        (parse_kb("MemTotal:"), parse_kb("MemAvailable:"))
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        (0, 0)
    }
}

fn parse_nvidia_smi_csv(stdout: &str) -> Option<(String, u64)> {
    let mut best: Option<(String, u64)> = None;
    for line in stdout.lines() {
        let mut parts = line.split(',');
        let name = parts.next()?.trim();
        let mib: u64 = parts.next()?.trim().parse().ok()?;
        let bytes = mib.saturating_mul(1024 * 1024);
        if best.as_ref().is_none_or(|(_, b)| bytes > *b) {
            best = Some((name.to_string(), bytes));
        }
    }
    best
}

fn probe_nvidia_smi() -> Option<(String, u64)> {
    let mut cmd = std::process::Command::new("nvidia-smi");
    cmd.args([
        "--query-gpu=name,memory.total",
        "--format=csv,noheader,nounits",
    ])
    .stdin(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    parse_nvidia_smi_csv(&text)
}

#[cfg(windows)]
fn probe_windows_registry_gpu() -> Option<(String, u64)> {
    use winreg::RegKey;
    use winreg::enums::HKEY_LOCAL_MACHINE;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let class_key = hklm
        .open_subkey(
            r"SYSTEM\ControlSet001\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}",
        )
        .ok()?;
    let mut best: Option<(String, u64)> = None;
    for sub in class_key.enum_keys().flatten() {
        if sub.len() != 4 || !sub.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let Ok(adapter) = class_key.open_subkey(&sub) else {
            continue;
        };
        let name: String = adapter
            .get_value("DriverDesc")
            .or_else(|_| adapter.get_value("HardwareInformation.AdapterString"))
            .unwrap_or_default();
        if name.trim().is_empty() {
            continue;
        }
        let vram: u64 = adapter
            .get_value::<u64, _>("HardwareInformation.qwMemorySize")
            .ok()
            .or_else(|| {
                adapter
                    .get_raw_value("HardwareInformation.MemorySize")
                    .ok()
                    .and_then(|raw| match raw.bytes.as_ref() {
                        b if b.len() == 8 => Some(u64::from_le_bytes(b.try_into().ok()?)),
                        b if b.len() == 4 => Some(u32::from_le_bytes(b.try_into().ok()?) as u64),
                        _ => None,
                    })
            })
            .unwrap_or(0);
        if vram > 0 && best.as_ref().is_none_or(|(_, b)| vram > *b) {
            best = Some((name.trim().to_string(), vram));
        }
    }
    best
}

#[cfg(target_os = "linux")]
fn probe_linux_drm_gpu() -> Option<(String, u64)> {
    let entries = std::fs::read_dir("/sys/class/drm").ok()?;
    let mut best: Option<(String, u64)> = None;
    for entry in entries.flatten() {
        let path = entry.path().join("device").join("mem_info_vram_total");
        if let Ok(raw) = std::fs::read_to_string(&path)
            && let Ok(bytes) = raw.trim().parse::<u64>()
            && bytes > 0
            && best.as_ref().is_none_or(|(_, b)| bytes > *b)
        {
            best = Some(("GPU".into(), bytes));
        }
    }
    best
}

fn detect_system_hardware() -> SystemHardwareInfo {
    let (total_ram_bytes, available_ram_bytes) = detect_ram_bytes();
    if let Some((name, vram)) = probe_nvidia_smi() {
        return SystemHardwareInfo {
            total_ram_bytes,
            available_ram_bytes,
            gpu_name: Some(name),
            gpu_vram_bytes: Some(vram),
            vram_source: "nvidia-smi".into(),
        };
    }
    #[cfg(windows)]
    if let Some((name, vram)) = probe_windows_registry_gpu() {
        return SystemHardwareInfo {
            total_ram_bytes,
            available_ram_bytes,
            gpu_name: Some(name),
            gpu_vram_bytes: Some(vram),
            vram_source: "windows-registry".into(),
        };
    }
    #[cfg(target_os = "linux")]
    if let Some((name, vram)) = probe_linux_drm_gpu() {
        return SystemHardwareInfo {
            total_ram_bytes,
            available_ram_bytes,
            gpu_name: Some(name),
            gpu_vram_bytes: Some(vram),
            vram_source: "sysfs-drm".into(),
        };
    }
    SystemHardwareInfo {
        total_ram_bytes,
        available_ram_bytes,
        gpu_name: None,
        gpu_vram_bytes: None,
        vram_source: "cpu-only".into(),
    }
}

#[tauri::command]
pub async fn system_hardware_info() -> CmdResult<SystemHardwareInfo> {
    tauri::async_runtime::spawn_blocking(detect_system_hardware)
        .await
        .map_err(err)
}

fn collect_gguf_roots(core: &Core) -> Vec<(PathBuf, &'static str)> {
    let ctx = core.hf_context();
    let mut roots = Vec::new();
    let base = if ctx.folder.trim().is_empty() {
        core.settings().downloads.default_dir.join("Models")
    } else {
        PathBuf::from(&ctx.folder)
    };
    roots.push((base.clone(), "huggingface"));
    if let Some(lm) = ctx.lm_studio.filter(|s| !s.trim().is_empty()) {
        let p = PathBuf::from(lm);
        if p != base {
            roots.push((p, "lmstudio"));
        }
    }
    let dl = core.settings().downloads.default_dir.clone();
    if dl != base {
        roots.push((dl, "other"));
    }
    roots
}

fn scan_gguf_dir(
    dir: &Path,
    source_hint: &str,
    depth: usize,
    seen: &mut HashSet<PathBuf>,
    out: &mut Vec<LocalGgufFile>,
) {
    if depth == 0 || !dir.is_dir() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let folder_name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            let next_source = if folder_name == "ollama" {
                "ollama"
            } else {
                source_hint
            };
            scan_gguf_dir(&path, next_source, depth - 1, seen, out);
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("gguf"))
        {
            let canon = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
            if !seen.insert(canon) {
                continue;
            }
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            let modified_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            let name = entry.file_name().to_string_lossy().into_owned();
            let parent = path
                .parent()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            out.push(LocalGgufFile {
                name,
                path: path.to_string_lossy().into_owned(),
                dir: parent,
                size: meta.len(),
                modified_ms,
                source: source_hint.to_string(),
            });
        }
    }
}

#[tauri::command]
pub async fn list_local_gguf_models(core: State<'_, Core>) -> CmdResult<Vec<LocalGgufFile>> {
    let roots = collect_gguf_roots(&core);
    tauri::async_runtime::spawn_blocking(move || {
        let mut seen = HashSet::new();
        let mut files = Vec::new();
        for (root, src) in roots {
            let depth = if src == "other" { 2 } else { 4 };
            scan_gguf_dir(&root, src, depth, &mut seen, &mut files);
        }
        files.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then(b.size.cmp(&a.size)));
        files
    })
    .await
    .map_err(err)
}

#[tauri::command]
pub async fn delete_local_gguf(core: State<'_, Core>, path: PathBuf) -> CmdResult<()> {
    if !path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("gguf"))
    {
        return Err("Only .gguf model files can be removed from Model Hub.".into());
    }
    let canon = std::fs::canonicalize(&path).map_err(|_| "GGUF file not found on disk")?;
    let allowed = collect_gguf_roots(&core).into_iter().any(|(root, _)| {
        std::fs::canonicalize(root)
            .map(|r| canon.starts_with(&r))
            .unwrap_or(false)
    });
    if !allowed {
        return Err("Refusing to delete a file outside HDM model folders.".into());
    }
    std::fs::remove_file(&canon).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_model_ref_handles_urls_and_tags() {
        assert_eq!(
            normalize_model_ref("Llama3.2:3B").unwrap(),
            ("llama3.2".into(), Some("3B".into()))
        );
        assert_eq!(
            normalize_model_ref("https://ollama.com/library/qwen2.5-coder:14b").unwrap(),
            ("qwen2.5-coder".into(), Some("14b".into()))
        );
        assert_eq!(
            normalize_model_ref("ollama:deepseek-r1:7b").unwrap(),
            ("deepseek-r1".into(), Some("7b".into()))
        );
        assert!(normalize_model_ref("../etc/passwd").is_err());
    }

    #[test]
    fn parse_oci_manifest_extracts_model_layer_and_projector() {
        let sample = serde_json::json!({
            "schemaVersion": 2,
            "mediaType": "application/vnd.docker.distribution.manifest.v2+json",
            "layers": [
                {
                    "mediaType": "application/vnd.ollama.image.model",
                    "digest": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
                    "size": 2019377696u64
                },
                {
                    "mediaType": "application/vnd.ollama.image.template",
                    "digest": "sha256:2222222222222222222222222222222222222222222222222222222222222222",
                    "size": 512u64
                },
                {
                    "mediaType": "application/vnd.ollama.image.projector",
                    "digest": "sha256:3333333333333333333333333333333333333333333333333333333333333333",
                    "size": 845000000u64
                }
            ]
        });

        let info = parse_oci_manifest_json(
            sample.to_string().as_bytes(),
            "gemma3",
            "4b",
            "C:\\Models\\Ollama\\gemma3".into(),
        )
        .unwrap();

        assert_eq!(info.full_ref, "gemma3:4b");
        assert_eq!(info.model_size, 2019377696);
        assert_eq!(info.file_name, "gemma3-4b.gguf");
        assert_eq!(
            info.blob_url,
            "https://registry.ollama.ai/v2/library/gemma3/blobs/sha256:1111111111111111111111111111111111111111111111111111111111111111"
        );
        assert!(info.has_template);
        assert!(!info.has_system);
        assert!(info.has_projector);
        assert_eq!(info.projector_size, Some(845000000));
    }

    #[test]
    fn parse_ollama_search_html_extracts_cards() {
        let html = r#"
          <ul>
            <li>
              <a href="/library/qwen3">
                <h2>qwen3</h2>
                <p>Hybrid thinking and tool-calling open LLM.</p>
                <span>tools</span>
                <span>thinking</span>
                <span>8b</span>
                <span>14b</span>
                <span>5.4M Pulls</span>
              </a>
            </li>
          </ul>
        "#;
        let items = parse_ollama_search_html(html);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "qwen3");
        assert_eq!(items[0].pulls.as_deref(), Some("5.4M"));
        assert!(items[0].capabilities.contains(&"thinking".to_string()));
        assert!(items[0].sizes.contains(&"8b".to_string()));
        assert_eq!(items[0].category, "reasoning");
    }

    #[test]
    fn parse_ollama_tags_html_extracts_tags_and_sizes() {
        let html = r#"
          <div>
            <a href="/library/qwen2.5-coder:7b">7b</a>
            <span>4.7 GB</span>
            <span>128K</span>
          </div>
          <div>
            <a href="/library/qwen2.5-coder:14b-instruct-q4_K_M">14b-instruct-q4_K_M</a>
            <span>9.0 GB</span>
          </div>
        "#;
        let tags = parse_ollama_tags_html(html, "qwen2.5-coder");
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0].tag, "7b");
        assert_eq!(tags[0].size_label.as_deref(), Some("4.7GB"));
        assert_eq!(tags[0].context.as_deref(), Some("128K"));
        assert_eq!(tags[1].tag, "14b-instruct-q4_K_M");
        assert_eq!(tags[1].size_label.as_deref(), Some("9.0GB"));
    }

    #[test]
    fn curated_catalog_filters_by_query_and_category() {
        let coding = merge_search_results(Vec::new(), "", Some("coding"));
        assert!(coding.iter().any(|m| m.name == "qwen2.5-coder"));
        assert!(!coding.iter().any(|m| m.name == "nomic-embed-text"));

        let qwen = merge_search_results(Vec::new(), "qwen", None);
        assert!(qwen.iter().any(|m| m.name == "qwen3"));
        assert!(qwen.iter().any(|m| m.name == "qwen2.5-coder"));
    }

    #[test]
    fn parse_nvidia_smi_csv_picks_largest_gpu() {
        let csv = "NVIDIA GeForce GTX 1650, 4096\nNVIDIA GeForce RTX 4070, 12288\n";
        let (name, bytes) = parse_nvidia_smi_csv(csv).unwrap();
        assert_eq!(name, "NVIDIA GeForce RTX 4070");
        assert_eq!(bytes, 12288 * 1024 * 1024);
    }
}
