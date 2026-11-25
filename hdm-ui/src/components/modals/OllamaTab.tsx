import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Box,
  CheckCircle2,
  Cpu,
  Download,
  FolderOpen,
  Search,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { useFreeSpace } from "../../hooks/useFreeSpace";
import { pickFolder } from "../../lib/dialog";
import { formatBytes } from "../../lib/format";
import {
  assessModelFit,
  fitBadgeClasses,
  parseSizeLabelToBytes,
} from "../../lib/hardware";
import { ipc } from "../../lib/ipc";
import type {
  OllamaLocalStatus,
  OllamaManifestInfo,
  OllamaModelSummary,
  OllamaTagInfo,
  StartMode,
  SystemHardwareInfo,
} from "../../lib/types";
import { useUiStore } from "../../store/uiStore";

interface OllamaTabProps {
  initialInput: string;
  onDone: () => void;
  fullPage?: boolean;
  hardware?: SystemHardwareInfo | null;
}

const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "general", label: "General" },
  { id: "reasoning", label: "Reasoning" },
  { id: "coding", label: "Coding" },
  { id: "vision", label: "Vision" },
  { id: "embedding", label: "Embedding" },
];

function parseDirectRef(raw: string): { model: string; tag: string } {
  let s = raw.trim();
  if (s.startsWith("ollama://")) s = s.slice(9);
  else if (s.startsWith("ollama:")) s = s.slice(7);
  if (s.includes("://")) {
    try {
      const u = new URL(s);
      const segs = u.pathname.split("/").filter(Boolean);
      if (segs[0] === "library") segs.shift();
      if (segs[segs.length - 1] === "tags") segs.pop();
      s = segs.join("/");
    } catch {
      // keep raw
    }
  }
  const idx = s.indexOf(":");
  if (idx > 0) {
    return {
      model: s.slice(0, idx).trim().toLowerCase(),
      tag: s.slice(idx + 1).trim() || "latest",
    };
  }
  return { model: s.trim().toLowerCase(), tag: "latest" };
}

export function OllamaTab({
  initialInput,
  onDone,
  fullPage = false,
  hardware: hardwareProp,
}: OllamaTabProps) {
  const pushToast = useUiStore((s) => s.pushToast);

  const [hardwareLocal, setHardwareLocal] = useState<SystemHardwareInfo | null>(null);
  const hardware = hardwareProp !== undefined ? hardwareProp : hardwareLocal;

  useEffect(() => {
    if (hardwareProp !== undefined) return;
    let alive = true;
    void ipc
      .systemHardwareInfo()
      .then((hw) => {
        if (alive) setHardwareLocal(hw);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [hardwareProp]);

  const [query, setQuery] = useState(initialInput);
  const [category, setCategory] = useState("all");
  const [models, setModels] = useState<OllamaModelSummary[]>([]);
  const [searching, setSearching] = useState(false);

  const [localStatus, setLocalStatus] = useState<OllamaLocalStatus | null>(null);
  const [showLocalList, setShowLocalList] = useState(false);

  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [tags, setTags] = useState<OllamaTagInfo[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [selectedTag, setSelectedTag] = useState("latest");
  const [customTag, setCustomTag] = useState("");

  const [manifest, setManifest] = useState<OllamaManifestInfo | null>(null);
  const [loadingManifest, setLoadingManifest] = useState(false);
  const [manifestError, setManifestError] = useState<string | null>(null);

  const [saveFolder, setSaveFolder] = useState("");
  const [writeModelfile, setWriteModelfile] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const freeBytes = useFreeSpace(saveFolder);

  useEffect(() => {
    let alive = true;
    void ipc
      .ollamaLocalStatus()
      .then((st) => {
        if (alive) setLocalStatus(st);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const runSearch = async (q: string, cat: string) => {
    setSearching(true);
    try {
      const list = await ipc.ollamaSearch(q, cat === "all" ? undefined : cat);
      setModels(list);
    } catch {
      setModels([]);
    } finally {
      setSearching(false);
    }
  };

  const inspectManifest = async (model: string, tag: string) => {
    setLoadingManifest(true);
    setManifestError(null);
    try {
      const info = await ipc.ollamaInspectManifest(model, tag);
      setManifest(info);
      setSaveFolder(info.defaultFolder);
    } catch (err) {
      setManifest(null);
      setManifestError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingManifest(false);
    }
  };

  const openModel = async (modelName: string, preferredTag = "latest") => {
    const clean = modelName.trim().toLowerCase();
    if (!clean) return;
    setSelectedModel(clean);
    setSelectedTag(preferredTag);
    setCustomTag("");
    setLoadingTags(true);
    setManifest(null);
    setManifestError(null);

    try {
      const fetchedTags = await ipc.ollamaModelTags(clean);
      setTags(fetchedTags);
      const initialTag =
        preferredTag !== "latest"
          ? preferredTag
          : fetchedTags[0]?.tag ?? "latest";
      setSelectedTag(initialTag);
      await inspectManifest(clean, initialTag);
    } catch (err) {
      setTags([{ tag: preferredTag }]);
      await inspectManifest(clean, preferredTag);
      if (err instanceof Error && err.message) {
        setManifestError(err.message);
      }
    } finally {
      setLoadingTags(false);
    }
  };

  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    void runSearch("", "all");
    if (initialInput.trim()) {
      const parsed = parseDirectRef(initialInput);
      if (parsed.model) {
        void openModel(parsed.model, parsed.tag);
      }
    }
  });

  const installedNames = useMemo(() => {
    const set = new Set<string>();
    for (const m of localStatus?.models ?? []) {
      set.add(m.name.toLowerCase());
      const base = m.name.split(":")[0]?.toLowerCase();
      if (base) set.add(base);
    }
    return set;
  }, [localStatus]);

  const handleBrowseFolder = async () => {
    const picked = await pickFolder(saveFolder || manifest?.defaultFolder);
    if (picked) setSaveFolder(picked);
  };

  const handleDownload = async (mode: StartMode) => {
    if (!selectedModel || !manifest || submitting) return;
    setSubmitting(true);
    setManifestError(null);
    try {
      const res = await ipc.ollamaDownload({
        model: manifest.model,
        tag: manifest.tag,
        saveDir: saveFolder.trim() || manifest.defaultFolder,
        mode,
        writeModelfile,
      });
      pushToast(
        "success",
        `${mode.type === "now" ? "Downloading" : "Saved"} ${res.fileName} (${formatBytes(res.size)})`
      );
      onDone();
    } catch (err) {
      setManifestError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const effectiveTag = customTag.trim() || selectedTag;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className={`${fullPage ? "p-6" : "p-5"} flex flex-col gap-4 overflow-y-auto min-h-0 flex-1`}>
        {/* Search & Local Daemon Bar */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label
              htmlFor="hdm-ollama-search"
              className="font-label text-label-md text-on-surface"
            >
              Ollama Model Library (Direct OCI Multi-Segment GGUF)
            </label>

            <div className="flex items-center gap-2">
              {localStatus && (
                <button
                  type="button"
                  onClick={() => setShowLocalList((v) => !v)}
                  className={`inline-flex items-center gap-1.5 font-mono text-mono-sm px-2.5 py-0.5 rounded-sm border transition-colors duration-state-change ${
                    localStatus.running
                      ? "bg-status-connected-tint border-status-connected/30 text-status-connected"
                      : "bg-surface border-outline text-on-surface-variant"
                  }`}
                >
                  <Terminal size={12} aria-hidden="true" />
                  <span>
                    {localStatus.running
                      ? `Local Ollama Running (${localStatus.models.length})`
                      : "Direct Registry Mode"}
                  </span>
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="hdm-ollama-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (query.includes(":") || query.includes("://")) {
                    const parsed = parseDirectRef(query);
                    void openModel(parsed.model, parsed.tag);
                  } else {
                    setSelectedModel(null);
                    void runSearch(query, category);
                  }
                }
              }}
              placeholder="Search models (llama3.3, qwen3, deepseek-r1) or type model:tag"
              className="flex-1 h-9 px-3 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary"
            />
            <button
              type="button"
              disabled={searching}
              onClick={() => {
                setSelectedModel(null);
                void runSearch(query, category);
              }}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded bg-surface-container-high border border-outline font-label text-label-md text-on-surface hover:border-primary/40 disabled:opacity-50"
            >
              <Search size={14} className="text-on-surface-variant" aria-hidden="true" />
              <span>Search</span>
            </button>
            {query.trim() && (
              <button
                type="button"
                onClick={() => {
                  const parsed = parseDirectRef(query);
                  void openModel(parsed.model, parsed.tag);
                }}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded bg-primary-tint border border-primary/40 font-label text-label-md text-on-primary-badge hover:bg-primary/20"
              >
                <Cpu size={14} aria-hidden="true" />
                <span>Inspect</span>
              </button>
            )}
          </div>

          {/* Category Filters */}
          {!selectedModel && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {CATEGORIES.map((c) => {
                const active = category === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setCategory(c.id);
                      void runSearch(query, c.id);
                    }}
                    className={`h-7 px-2.5 rounded-sm font-label text-label-sm border transition-colors duration-state-change ${
                      active
                        ? "bg-primary-tint border-primary text-on-primary-badge"
                        : "bg-surface border-outline text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
                    }`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Optional Local Ollama Models Panel */}
        {showLocalList && localStatus && (
          <div className="rounded-md bg-surface border border-outline p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
                Installed in Local Ollama ({localStatus.models.length})
              </span>
              {localStatus.modelsDir && (
                <span className="font-mono text-mono-sm text-on-surface-variant truncate max-w-[60%]">
                  {localStatus.modelsDir}
                </span>
              )}
            </div>
            {localStatus.models.length === 0 ? (
              <span className="font-body text-body-sm text-on-surface-variant">
                No local models reported at {localStatus.endpoint}.
              </span>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-36 overflow-y-auto">
                {localStatus.models.map((lm) => (
                  <div
                    key={lm.name}
                    className="px-2.5 py-1.5 rounded bg-surface-container border border-outline flex items-center justify-between gap-2"
                  >
                    <span className="font-mono text-mono-sm text-on-surface truncate">
                      {lm.name}
                    </span>
                    <span className="font-mono text-mono-sm tabular text-on-surface-variant shrink-0">
                      {formatBytes(lm.size)}
                      {lm.quantization ? ` · ${lm.quantization}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Catalog List vs Selected Model Tag & Manifest Inspector */}
        {!selectedModel ? (
          searching ? (
            <div className="rounded-md bg-surface border border-outline p-5 font-mono text-mono-sm text-on-surface-variant">
              Searching Ollama library…
            </div>
          ) : models.length === 0 ? (
            <div className="rounded-md bg-surface border border-outline p-5 flex flex-col gap-2">
              <span className="font-body text-body-sm text-on-surface-variant">
                No matching models in catalog for “{query}”. You can still inspect any Ollama model slug directly:
              </span>
              {query.trim() && (
                <button
                  type="button"
                  onClick={() => {
                    const parsed = parseDirectRef(query);
                    void openModel(parsed.model, parsed.tag);
                  }}
                  className="self-start inline-flex items-center gap-1.5 h-8 px-3 rounded bg-primary-tint border border-primary/40 font-label text-label-sm text-on-primary-badge"
                >
                  <Box size={13} aria-hidden="true" />
                  <span>Inspect registry.ollama.ai/library/{parseDirectRef(query).model}</span>
                </button>
              )}
            </div>
          ) : (
            <div
              className={`grid gap-2.5 ${
                fullPage
                  ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
                  : "grid-cols-1 sm:grid-cols-2 max-h-80 overflow-y-auto pr-1"
              }`}
            >
              {models.map((m) => {
                const isInstalled = installedNames.has(m.name.toLowerCase());
                return (
                  <button
                    key={m.name}
                    type="button"
                    onClick={() => void openModel(m.name, "latest")}
                    className="p-3 rounded-md bg-surface border border-outline hover:border-primary/50 hover:bg-surface-container-high text-left flex flex-col justify-between gap-2 transition-colors duration-state-change"
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-mono-md text-on-surface font-medium truncate">
                          {m.name}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          {isInstalled && (
                            <span className="inline-flex items-center gap-1 font-mono text-mono-sm px-1.5 py-0.5 rounded-sm bg-status-connected-tint text-status-connected">
                              <CheckCircle2 size={10} aria-hidden="true" />
                              Local
                            </span>
                          )}
                          {m.pulls && (
                            <span className="font-mono text-mono-sm tabular text-on-surface-variant">
                              {m.pulls}
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="font-body text-body-sm text-on-surface-variant line-clamp-2">
                        {m.description}
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1 flex-wrap">
                        {m.sizes.slice(0, 4).map((sz) => (
                          <span
                            key={sz}
                            className="font-mono text-mono-sm px-1.5 py-0.5 rounded-sm bg-surface-container border border-outline text-on-surface-variant"
                          >
                            {sz}
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center gap-1">
                        {m.capabilities.slice(0, 2).map((cap) => (
                          <span
                            key={cap}
                            className="font-mono text-mono-sm px-1.5 py-0.5 rounded-sm bg-primary-badge text-on-primary-badge"
                          >
                            {cap}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )
        ) : (
          /* Selected Model Inspector */
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  setSelectedModel(null);
                  setManifest(null);
                  setManifestError(null);
                }}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded bg-surface border border-outline font-label text-label-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
              >
                <ArrowLeft size={13} aria-hidden="true" />
                <span>Back to Ollama Catalog</span>
              </button>

              <span className="font-mono text-mono-sm text-on-surface-variant">
                registry.ollama.ai/v2/{selectedModel.includes("/") ? selectedModel : `library/${selectedModel}`}
              </span>
            </div>

            {/* Tag / Size Picker */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
                  Select Parameter Tag / Quantization
                </span>
                {loadingTags && (
                  <span className="font-mono text-mono-sm text-on-surface-variant">
                    Loading tags…
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-36 overflow-y-auto">
                {tags.slice(0, 24).map((t) => {
                  const active = !customTag.trim() && selectedTag === t.tag;
                  const tagBytes = parseSizeLabelToBytes(t.sizeLabel);
                  const tagFit = tagBytes ? assessModelFit(tagBytes, hardware) : null;
                  return (
                    <button
                      key={t.tag}
                      type="button"
                      onClick={() => {
                        setCustomTag("");
                        setSelectedTag(t.tag);
                        void inspectManifest(selectedModel, t.tag);
                      }}
                      className={`p-2 rounded border text-left flex flex-col gap-0.5 transition-colors duration-state-change ${
                        active
                          ? "bg-primary-tint border-primary text-on-surface"
                          : "bg-surface border-outline hover:bg-surface-container-high text-on-surface-variant"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-mono text-mono-md text-on-surface truncate">
                          {t.tag}
                        </span>
                        {tagFit && (
                          <span
                            title={tagFit.detail}
                            className={`font-mono text-[10px] px-1 rounded-sm shrink-0 ${fitBadgeClasses(tagFit.tone)}`}
                          >
                            {tagFit.tone === "vram"
                              ? "VRAM"
                              : tagFit.tone === "ram"
                              ? "RAM"
                              : "Tight"}
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-mono-sm tabular text-on-surface-variant">
                        {t.sizeLabel ?? "Inspect blob"}
                        {t.context ? ` · ${t.context}` : ""}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={customTag}
                  onChange={(e) => setCustomTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customTag.trim()) {
                      e.preventDefault();
                      void inspectManifest(selectedModel, customTag.trim());
                    }
                  }}
                  placeholder={`Or enter exact tag (active: ${effectiveTag})`}
                  className="flex-1 h-8 px-3 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary"
                />
                <button
                  type="button"
                  disabled={!customTag.trim() || loadingManifest}
                  onClick={() => void inspectManifest(selectedModel, customTag.trim())}
                  className="h-8 px-3 rounded bg-surface-container-high border border-outline font-label text-label-sm text-on-surface hover:border-primary/40 disabled:opacity-40"
                >
                  Resolve Tag
                </button>
              </div>
            </div>

            {loadingManifest && (
              <div className="rounded-md bg-surface border border-outline p-3 font-mono text-mono-sm text-on-surface-variant">
                Resolving OCI manifest &amp; GGUF blob SHA-256 from registry.ollama.ai…
              </div>
            )}

            {manifestError && (
              <div className="rounded bg-primary-tint border border-primary/40 px-3 py-2 font-mono text-mono-sm text-on-primary-badge">
                {manifestError}
              </div>
            )}

            {manifest && (() => {
              const manifestFit = assessModelFit(manifest.modelSize, hardware);
              return (
              <div className="rounded-md bg-surface border border-outline p-3.5 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex flex-col gap-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-title text-title-md text-on-surface">
                        {manifest.fileName}
                      </span>
                      <span className="font-mono text-mono-sm px-1.5 py-0.5 rounded-sm bg-status-connected-tint text-status-connected inline-flex items-center gap-1">
                        <ShieldCheck size={11} aria-hidden="true" />
                        SHA-256
                      </span>
                      {manifestFit && (
                        <span
                          title={manifestFit.detail}
                          className={`font-mono text-mono-sm px-1.5 py-0.5 rounded-sm ${fitBadgeClasses(manifestFit.tone)}`}
                        >
                          {manifestFit.label}
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-mono-sm text-on-surface-variant truncate">
                      {manifest.modelDigest}
                    </span>
                  </div>
                  <span className="font-mono text-mono-md tabular text-on-surface shrink-0">
                    {formatBytes(manifest.modelSize)}
                  </span>
                </div>

                {/* Save Folder + Modelfile Option */}
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="hdm-ollama-folder"
                    className="font-label text-label-md text-on-surface"
                  >
                    Destination Folder
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="hdm-ollama-folder"
                      type="text"
                      value={saveFolder}
                      onChange={(e) => setSaveFolder(e.target.value)}
                      className="flex-1 h-8 px-3 rounded bg-surface-container border border-outline font-mono text-mono-sm text-on-surface focus:outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      onClick={() => void handleBrowseFolder()}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-surface-container-high border border-outline font-label text-label-md text-on-surface hover:border-primary/40"
                    >
                      <FolderOpen size={14} className="text-on-surface-variant" aria-hidden="true" />
                      <span>Browse</span>
                    </button>
                  </div>
                </div>

                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={writeModelfile}
                    onChange={(e) => setWriteModelfile(e.target.checked)}
                    className="accent-[#E11D2E]"
                  />
                  <span className="font-body text-body-sm text-on-surface-variant">
                    Generate sibling <span className="font-mono text-on-surface">Modelfile</span> (one-click import into local Ollama on completion)
                  </span>
                </label>
              </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3.5 border-t border-outline bg-surface flex items-center justify-between gap-3 shrink-0">
        <span className="font-mono text-mono-sm tabular text-on-surface-variant truncate">
          Free disk space: {freeBytes != null ? formatBytes(freeBytes) : "—"}
          {manifest ? ` • ${manifest.fullRef} (${formatBytes(manifest.modelSize)})` : ""}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={!manifest || submitting || loadingManifest}
            onClick={() => void handleDownload({ type: "later" })}
            className="h-8 px-3 rounded bg-surface-container-high border border-outline text-on-surface font-label text-label-md hover:border-primary/40 disabled:opacity-40"
          >
            Save Idle
          </button>
          <button
            type="button"
            disabled={!manifest || submitting || loadingManifest}
            onClick={() => void handleDownload({ type: "now" })}
            className="inline-flex items-center gap-1.5 h-8 px-4 rounded bg-primary text-on-primary font-label text-label-md hover:bg-primary/90 disabled:opacity-40"
          >
            <Download size={14} aria-hidden="true" />
            <span>{submitting ? "Starting…" : "Download GGUF"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
