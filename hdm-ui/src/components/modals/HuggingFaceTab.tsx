import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Cpu,
  Download,
  FolderOpen,
  Heart,
  Search,
  ShieldCheck,
  Sliders,
} from "lucide-react";
import { useFreeSpace } from "../../hooks/useFreeSpace";
import { pickFolder } from "../../lib/dialog";
import { formatBytes } from "../../lib/format";
import { assessModelFit, fitBadgeClasses } from "../../lib/hardware";
import { ipc } from "../../lib/ipc";
import type {
  HfBrowseHit,
  HfBrowseSort,
  HfContext,
  HfPresent,
  HfRepo,
  StartMode,
  SystemHardwareInfo,
} from "../../lib/types";
import { useUiStore } from "../../store/uiStore";

interface HuggingFaceTabProps {
  initialInput: string;
  onDone: () => void;
  fullPage?: boolean;
  hardware?: SystemHardwareInfo | null;
}

const SORT_OPTIONS: { id: HfBrowseSort; label: string }[] = [
  { id: "trending", label: "Trending" },
  { id: "downloads", label: "Most Downloaded" },
  { id: "likes", label: "Most Liked" },
  { id: "recent", label: "Recent" },
];

function explainHfError(code: string): string {
  switch (code) {
    case "hf:notFound":
      return "Repository not found on Hugging Face (or it is private without a token).";
    case "hf:needsToken":
      return "This repository requires a Hugging Face access token. Add one in Settings → Hugging Face Auth.";
    case "hf:badToken":
      return "Hugging Face rejected the configured access token.";
    case "hf:gated":
      return "This is a gated model. Accept its terms on huggingface.co with the same account as your token.";
    case "hf:rateLimited":
      return "Hugging Face API rate limit reached. Try again shortly or configure a token.";
    case "hf:network":
      return "Could not reach the Hugging Face Hub endpoint.";
    default:
      return code;
  }
}

export function HuggingFaceTab({
  initialInput,
  onDone,
  fullPage = false,
  hardware: hardwareProp,
}: HuggingFaceTabProps) {
  const pushToast = useUiStore((s) => s.pushToast);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const setSettingsSection = useUiStore((s) => s.setSettingsSection);

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
  const [sort, setSort] = useState<HfBrowseSort>("trending");
  const [ggufOnly, setGgufOnly] = useState(true);
  const [ctx, setCtx] = useState<HfContext | null>(null);
  const [repo, setRepo] = useState<HfRepo | null>(null);
  const [hits, setHits] = useState<HfBrowseHit[]>([]);
  const [present, setPresent] = useState<HfPresent | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
    () => new Set()
  );
  const [saveFolder, setSaveFolder] = useState("");
  const [allFilesOpen, setAllFilesOpen] = useState(false);

  const freeBytes = useFreeSpace(saveFolder);

  useEffect(() => {
    void ipc
      .hfContext()
      .then((c) => setCtx(c))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!repo || !saveFolder.trim()) {
      setPresent(null);
      return;
    }
    let alive = true;
    void ipc
      .hfPresent({
        kind: repo.kind,
        id: repo.id,
        sha: repo.sha,
        folder: saveFolder.trim(),
        files: repo.files,
      })
      .then((res) => {
        if (alive) setPresent(res);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [repo, saveFolder]);

  const applyVariantSelection = (loaded: HfRepo, variantLabel: string | null) => {
    setSelectedVariant(variantLabel);
    if (!variantLabel) {
      setSelectedPaths(new Set(loaded.suggestion.files));
      return;
    }
    const v = loaded.suggestion.variants.find((item) => item.label === variantLabel);
    if (!v) return;
    setSelectedPaths(new Set([...v.files, ...loaded.suggestion.extras]));
  };

  const loadRepo = async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const loaded = await ipc.hfRepo(trimmed);
      setRepo(loaded);
      setSaveFolder(loaded.folder);
      setSelectedVariant(loaded.suggestion.variant ?? null);
      setSelectedPaths(new Set(loaded.suggestion.files));
      setAllFilesOpen(loaded.suggestion.variants.length === 0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(explainHfError(msg));
    } finally {
      setLoading(false);
    }
  };

  const runBrowse = async (
    searchInput: string,
    nextSort: HfBrowseSort = sort,
    nextGguf: boolean = ggufOnly
  ) => {
    setLoading(true);
    setErrorMsg(null);
    setRepo(null);
    try {
      const results = await ipc.hfBrowse({
        query: searchInput.trim() || undefined,
        sort: nextSort,
        ggufOnly: nextGguf,
        limit: fullPage ? 30 : 18,
      });
      setHits(results);
      if (results.length === 0 && searchInput.trim()) {
        setErrorMsg("No matching models found on Hugging Face.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(explainHfError(msg));
    } finally {
      setLoading(false);
    }
  };

  const didAutoLoad = useRef(false);
  useEffect(() => {
    if (didAutoLoad.current) return;
    didAutoLoad.current = true;
    if (initialInput.trim()) {
      void loadRepo(initialInput);
    } else {
      void runBrowse("", "trending", true);
    }
  });

  const handleBrowseFolder = async () => {
    const picked = await pickFolder(saveFolder || ctx?.folder);
    if (picked) setSaveFolder(picked);
  };

  const handleApplyLmStudio = () => {
    if (!ctx?.lmStudio || !repo) return;
    const sep = ctx.lmStudio.includes("\\") ? "\\" : "/";
    const base = ctx.lmStudio.replace(/[\\/]+$/, "");
    const parts = repo.id.split("/");
    setSaveFolder(`${base}${sep}${parts.join(sep)}`);
  };

  const selectedFilesList = repo
    ? repo.files.filter((f) => selectedPaths.has(f.path))
    : [];
  const selectedTotalBytes = selectedFilesList.reduce(
    (sum, f) => sum + f.size,
    0
  );

  const handleAdd = async (mode: StartMode | null) => {
    if (!repo || selectedFilesList.length === 0 || submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const count = await ipc.hfAdd({
        kind: repo.kind,
        id: repo.id,
        sha: repo.sha,
        files: selectedFilesList,
        folder: saveFolder.trim() || repo.folder,
        mode,
      });
      pushToast(
        "success",
        count > 0
          ? `Added ${count} model file(s) from ${repo.id}`
          : `${repo.id} files already present`
      );
      onDone();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const onDiskSet = new Set(present?.onDisk ?? []);
  const listedSet = new Set(present?.listed ?? []);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className={`${fullPage ? "p-6" : "p-5"} flex flex-col gap-4 overflow-y-auto min-h-0 flex-1`}>
        {/* Repo / Search Bar */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label
              htmlFor="hdm-hf-input"
              className="font-label text-label-md text-on-surface"
            >
              Hugging Face Models &amp; GGUF Weights
            </label>
            <div className="flex items-center gap-2">
              {ctx && (
                <span className="font-mono text-mono-sm px-2 py-0.5 rounded-sm bg-surface border border-outline text-on-surface-variant">
                  {ctx.token ? `Token: ${ctx.token}` : "Public (No Token)"}
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setSettingsSection("huggingface");
                  setActiveView("settings");
                  onDone();
                }}
                className="inline-flex items-center gap-1 font-label text-label-sm text-on-surface-variant hover:text-on-surface"
              >
                <Sliders size={12} aria-hidden="true" />
                <span>HF Auth</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="hdm-hf-input"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (query.includes("/") || query.includes("://")) {
                    void loadRepo(query);
                  } else {
                    void runBrowse(query);
                  }
                }
              }}
              placeholder="Search models (qwen, llama, gemma) or paste owner/model-gguf"
              className="flex-1 h-9 px-3 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary"
            />
            <button
              type="button"
              disabled={loading}
              onClick={() => void runBrowse(query)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded bg-surface-container-high border border-outline font-label text-label-md text-on-surface hover:border-primary/40 disabled:opacity-50"
            >
              <Search size={14} className="text-on-surface-variant" aria-hidden="true" />
              <span>{query.trim() ? "Search" : "Browse"}</span>
            </button>
            {query.includes("/") && (
              <button
                type="button"
                disabled={loading || !query.trim()}
                onClick={() => void loadRepo(query)}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded bg-primary-tint border border-primary/40 font-label text-label-md text-on-primary-badge hover:bg-primary/20 disabled:opacity-50"
              >
                <Cpu size={14} aria-hidden="true" />
                <span>Load Repo</span>
              </button>
            )}
          </div>

          {/* Sort & GGUF Filter Pills (when browsing catalog) */}
          {!repo && (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 flex-wrap">
                {SORT_OPTIONS.map((opt) => {
                  const active = sort === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setSort(opt.id);
                        void runBrowse(query, opt.id, ggufOnly);
                      }}
                      className={`h-7 px-2.5 rounded-sm font-label text-label-sm border transition-colors duration-state-change ${
                        active
                          ? "bg-primary-tint border-primary text-on-primary-badge"
                          : "bg-surface border-outline text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  const next = !ggufOnly;
                  setGgufOnly(next);
                  void runBrowse(query, sort, next);
                }}
                className={`h-7 px-2.5 rounded-sm font-mono text-mono-sm border transition-colors duration-state-change ${
                  ggufOnly
                    ? "bg-status-connected-tint border-status-connected/40 text-status-connected"
                    : "bg-surface border-outline text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {ggufOnly ? "Filter: GGUF Only ✓" : "Filter: All Formats"}
              </button>
            </div>
          )}
        </div>

        {loading && (
          <div className="rounded-md bg-surface border border-outline p-4 font-mono text-mono-sm text-on-surface-variant">
            Querying Hugging Face Hub API…
          </div>
        )}

        {errorMsg && (
          <div className="rounded bg-primary-tint border border-primary/40 px-3 py-2 font-mono text-mono-sm text-on-primary-badge">
            {errorMsg}
          </div>
        )}

        {/* Browse / Search Results */}
        {!loading && hits.length > 0 && !repo && (
          <div
            className={`grid gap-2.5 ${
              fullPage
                ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
                : "grid-cols-1 max-h-72 overflow-y-auto pr-1"
            }`}
          >
            {hits.map((hit) => (
              <button
                key={hit.id}
                type="button"
                onClick={() => {
                  setQuery(hit.id);
                  void loadRepo(hit.id);
                }}
                className="p-3 rounded-md bg-surface border border-outline hover:border-primary/50 hover:bg-surface-container-high text-left flex flex-col justify-between gap-2 transition-colors duration-state-change"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-mono-md text-on-surface break-all">
                    {hit.id}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {hit.gguf && (
                      <span className="font-mono text-mono-sm px-1.5 py-0.5 rounded-sm bg-primary-badge text-on-primary-badge">
                        GGUF
                      </span>
                    )}
                    {hit.gated && (
                      <span className="font-mono text-mono-sm px-1.5 py-0.5 rounded-sm bg-status-warning-tint text-status-warning">
                        Gated
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 text-on-surface-variant">
                  <span className="font-label text-label-sm truncate">
                    {hit.pipelineTag || "model"}
                  </span>
                  <div className="flex items-center gap-3 font-mono text-mono-sm tabular shrink-0">
                    {hit.likes != null && (
                      <span className="inline-flex items-center gap-1">
                        <Heart size={10} aria-hidden="true" />
                        {hit.likes.toLocaleString()}
                      </span>
                    )}
                    {hit.downloads != null && (
                      <span>{hit.downloads.toLocaleString()} dl</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Loaded Repo Details */}
        {repo && (
          <>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setRepo(null);
                  setErrorMsg(null);
                  if (hits.length === 0) {
                    void runBrowse("", sort, ggufOnly);
                  }
                }}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded bg-surface border border-outline font-label text-label-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
              >
                <ArrowLeft size={13} aria-hidden="true" />
                <span>Back to Browse</span>
              </button>
            </div>

            <div className="rounded-md bg-surface border border-outline p-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0 flex flex-col gap-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-title text-title-md text-on-surface">
                    {repo.id}
                  </span>
                  {repo.gguf && (
                    <span className="font-mono text-mono-sm px-1.5 py-0.5 rounded-sm bg-primary-badge text-on-primary-badge">
                      GGUF
                    </span>
                  )}
                  {repo.gated && (
                    <span className="font-mono text-mono-sm px-1.5 py-0.5 rounded-sm bg-status-warning-tint text-status-warning">
                      Gated
                    </span>
                  )}
                </div>
                <span className="font-mono text-mono-sm text-on-surface-variant">
                  rev {repo.revision} ({repo.sha.slice(0, 8)}) • {repo.files.length} files
                </span>
              </div>
              <span className="font-mono text-mono-md tabular text-on-surface shrink-0">
                {formatBytes(selectedTotalBytes)}
              </span>
            </div>

            {/* Quantization Variant Picker */}
            {repo.suggestion.variants.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
                  Quantization Variants
                </span>
                <div className="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto">
                  {repo.suggestion.variants.map((variant) => {
                    const active = selectedVariant === variant.label;
                    const fit = assessModelFit(variant.size, hardware);
                    return (
                      <button
                        key={variant.label}
                        type="button"
                        onClick={() => applyVariantSelection(repo, variant.label)}
                        className={`p-2 rounded border text-left flex flex-col gap-0.5 transition-colors duration-state-change ease-state-change ${
                          active
                            ? "bg-primary-tint border-primary text-on-surface"
                            : "bg-surface border-outline hover:bg-surface-container-high text-on-surface-variant"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-mono text-mono-md text-on-surface truncate">
                            {variant.label}
                          </span>
                          {fit && (
                            <span
                              title={fit.detail}
                              className={`font-mono text-[10px] px-1 rounded-sm shrink-0 ${fitBadgeClasses(fit.tone)}`}
                            >
                              {fit.tone === "vram"
                                ? "VRAM"
                                : fit.tone === "ram"
                                ? "RAM"
                                : "Tight"}
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-mono-sm tabular text-on-surface-variant">
                          {formatBytes(variant.size)} • {variant.files.length}f
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Save Folder + LM Studio Shortcut */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="hdm-hf-folder"
                  className="font-label text-label-md text-on-surface"
                >
                  Destination Model Folder
                </label>
                {ctx?.lmStudio && (
                  <button
                    type="button"
                    onClick={handleApplyLmStudio}
                    className="font-label text-label-sm text-on-primary-badge hover:underline"
                  >
                    Use LM Studio Folder
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="hdm-hf-folder"
                  type="text"
                  value={saveFolder}
                  onChange={(e) => setSaveFolder(e.target.value)}
                  className="flex-1 h-8 px-3 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface focus:outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => void handleBrowseFolder()}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-surface-container-high border border-outline font-label text-label-md text-on-surface hover:border-primary/40"
                >
                  <FolderOpen
                    size={14}
                    className="text-on-surface-variant"
                    aria-hidden="true"
                  />
                  <span>Browse</span>
                </button>
              </div>
            </div>

            {/* Expandable File List with SHA-256 & On-Disk status */}
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setAllFilesOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 font-label text-label-sm text-on-surface-variant hover:text-on-surface self-start"
              >
                {allFilesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span>
                  Repository Files ({selectedFilesList.length} of {repo.files.length} selected)
                </span>
              </button>

              {allFilesOpen && (
                <div className="max-h-44 overflow-y-auto rounded-md bg-surface border border-outline divide-y divide-outline-subtle">
                  {repo.files.map((file) => {
                    const checked = selectedPaths.has(file.path);
                    const onDisk = onDiskSet.has(file.path);
                    const queued = listedSet.has(file.path);
                    return (
                      <label
                        key={file.path}
                        className="px-3 py-1.5 flex items-center justify-between gap-2 cursor-pointer hover:bg-surface-container-high"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setSelectedVariant(null);
                              setSelectedPaths((prev) => {
                                const next = new Set(prev);
                                if (next.has(file.path)) next.delete(file.path);
                                else next.add(file.path);
                                return next;
                              });
                            }}
                            className="accent-[#E11D2E]"
                          />
                          <span className="font-mono text-mono-sm text-on-surface truncate">
                            {file.path}
                          </span>
                          {file.sha256 && (
                            <ShieldCheck
                              size={12}
                              className="text-status-connected shrink-0"
                              aria-label="SHA-256 available"
                            />
                          )}
                          {onDisk && (
                            <span className="font-mono text-mono-sm px-1.5 rounded-sm bg-status-connected-tint text-status-connected shrink-0">
                              On Disk
                            </span>
                          )}
                          {!onDisk && queued && (
                            <span className="font-mono text-mono-sm px-1.5 rounded-sm bg-surface-container-high text-on-surface-variant shrink-0">
                              In List
                            </span>
                          )}
                        </span>
                        <span className="font-mono text-mono-sm tabular text-on-surface-variant shrink-0">
                          {formatBytes(file.size)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3.5 border-t border-outline bg-surface flex items-center justify-between gap-3 shrink-0">
        <span className="font-mono text-mono-sm tabular text-on-surface-variant truncate">
          Free disk space: {freeBytes != null ? formatBytes(freeBytes) : "—"}
          {repo ? ` • ${selectedFilesList.length} selected (${formatBytes(selectedTotalBytes)})` : ""}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={!repo || selectedFilesList.length === 0 || submitting}
            onClick={() => void handleAdd({ type: "later" })}
            className="h-8 px-3 rounded bg-surface-container-high border border-outline text-on-surface font-label text-label-md hover:border-primary/40 disabled:opacity-40"
          >
            Save Idle
          </button>
          <button
            type="button"
            disabled={!repo || selectedFilesList.length === 0 || submitting}
            onClick={() => void handleAdd(null)}
            className="inline-flex items-center gap-1.5 h-8 px-4 rounded bg-primary text-on-primary font-label text-label-md hover:bg-primary/90 disabled:opacity-40"
          >
            <Download size={14} aria-hidden="true" />
            <span>{submitting ? "Adding…" : "Download Model"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
