import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  FolderOpen,
  Globe,
  ListPlus,
  Play,
  Sparkles,
  Square,
} from "lucide-react";
import { useFreeSpace } from "../../hooks/useFreeSpace";
import { pickFolder } from "../../lib/dialog";
import { formatBytes } from "../../lib/format";
import { ipc, onCoreEvent } from "../../lib/ipc";
import type {
  BatchInfo,
  GrabberFoundFile,
  GrabberScope,
  StartMode,
} from "../../lib/types";
import { useDownloadsStore } from "../../store/downloadsStore";
import { useUiStore } from "../../store/uiStore";

interface BatchGrabberTabProps {
  onBatchReady: (batch: BatchInfo) => void;
  onDone: () => void;
}

type SubMode = "urls" | "pattern" | "grabber";

export function BatchGrabberTab({ onBatchReady, onDone }: BatchGrabberTabProps) {
  const defaultDir = useDownloadsStore(
    (s) => s.settings?.downloads.defaultDir ?? ""
  );
  const queues = useDownloadsStore((s) => s.queues);
  const pushToast = useUiStore((s) => s.pushToast);

  const [mode, setMode] = useState<SubMode>("urls");
  const [urlText, setUrlText] = useState("");
  const [pattern, setPattern] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Site Grabber state
  const [grabUrl, setGrabUrl] = useState("");
  const [grabDepth, setGrabDepth] = useState(2);
  const [grabMaxPages, setGrabMaxPages] = useState(200);
  const [grabScope, setGrabScope] = useState<GrabberScope>("sameHost");
  const [grabExts, setGrabExts] = useState("pdf, zip, mp4, mp3, gguf");
  const [includeEmbedded, setIncludeEmbedded] = useState(false);
  const [keepStructure, setKeepStructure] = useState(false);
  const [saveDir, setSaveDir] = useState(defaultDir);
  const [targetQueueId, setTargetQueueId] = useState<string>("");

  const [projectId, setProjectId] = useState<string | null>(null);
  const [crawling, setCrawling] = useState(false);
  const [pagesVisited, setPagesVisited] = useState(0);
  const [foundFiles, setFoundFiles] = useState<GrabberFoundFile[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(() => new Set());
  const [fileFilter, setFileFilter] = useState("");
  const [downloading, setDownloading] = useState(false);

  const activeProjectRef = useRef<string | null>(null);
  const freeBytes = useFreeSpace(saveDir);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    void onCoreEvent((ev) => {
      if (!alive || ev.type !== "grabber") return;
      if (ev.payload.project_id !== activeProjectRef.current) return;
      const ge = ev.payload.event;
      if (ge.type === "pageVisited") {
        setPagesVisited(ge.pages);
      } else if (ge.type === "fileFound") {
        setFoundFiles((prev) => {
          if (prev.some((f) => f.url === ge.file.url)) return prev;
          return [...prev, ge.file];
        });
        setSelectedUrls((prev) => {
          const next = new Set(prev);
          next.add(ge.file.url);
          return next;
        });
      } else if (ge.type === "finished") {
        setPagesVisited(ge.pages);
        setCrawling(false);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  const handleParseText = async () => {
    if (!urlText.trim() || busy) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const batch = await ipc.batchFromText(urlText);
      onBatchReady(batch);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleParsePattern = async () => {
    if (!pattern.trim() || busy) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const batch = await ipc.batchFromPattern(pattern.trim());
      onBatchReady(batch);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleStartGrabber = async () => {
    const startUrl = grabUrl.trim();
    if (!startUrl) {
      setErrorMsg("Enter a starting URL (https://...) to crawl.");
      return;
    }
    setErrorMsg(null);
    setFoundFiles([]);
    setSelectedUrls(new Set());
    setPagesVisited(0);
    setCrawling(true);
    try {
      const extensions = grabExts
        .split(/[,\s]+/)
        .map((e) => e.trim().replace(/^\./, "").toLowerCase())
        .filter(Boolean);
      const proj = await ipc.startGrabber(`Crawl ${startUrl}`, {
        startUrl,
        depth: Math.max(1, Math.min(5, grabDepth)),
        scope: grabScope,
        extensions,
        includeEmbedded,
        filesAnyHost: true,
        maxPages: Math.max(10, Math.min(2000, grabMaxPages)),
        concurrency: 6,
        exclude: ["logout", "signout"],
        fetchSizes: true,
        userAgent: "",
        cookies: "",
      });
      activeProjectRef.current = proj.id;
      setProjectId(proj.id);
    } catch (err) {
      setCrawling(false);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStopGrabber = async () => {
    if (!projectId) return;
    await ipc.stopGrabber(projectId).catch(() => {});
    setCrawling(false);
  };

  const filteredFiles = useMemo(() => {
    const q = fileFilter.trim().toLowerCase();
    if (!q) return foundFiles;
    return foundFiles.filter(
      (f) =>
        f.fileName.toLowerCase().includes(q) || f.url.toLowerCase().includes(q)
    );
  }, [foundFiles, fileFilter]);

  const handleDownloadGrabbed = async (startMode: StartMode) => {
    if (!projectId || selectedUrls.size === 0 || downloading) return;
    setDownloading(true);
    setErrorMsg(null);
    try {
      const count = await ipc.downloadGrabbed({
        projectId,
        urls: Array.from(selectedUrls),
        saveDir: saveDir.trim() || defaultDir,
        keepStructure,
        mode: targetQueueId ? { type: "queue", queueId: targetQueueId } : startMode,
      });
      pushToast("success", `Queued ${count} grabbed file(s)`);
      onDone();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="p-5 flex flex-col gap-4 overflow-y-auto min-h-0 flex-1">
        {/* Mode Switcher */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setMode("urls");
              setErrorMsg(null);
            }}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded border font-label text-label-sm transition-colors duration-state-change ${
              mode === "urls"
                ? "bg-primary-tint border-primary text-on-primary-badge"
                : "bg-surface border-outline text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <ListPlus size={13} aria-hidden="true" />
            <span>Paste URL List</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("pattern");
              setErrorMsg(null);
            }}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded border font-label text-label-sm transition-colors duration-state-change ${
              mode === "pattern"
                ? "bg-primary-tint border-primary text-on-primary-badge"
                : "bg-surface border-outline text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <Sparkles size={13} aria-hidden="true" />
            <span>URL Pattern ([01..20])</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("grabber");
              setErrorMsg(null);
            }}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded border font-label text-label-sm transition-colors duration-state-change ${
              mode === "grabber"
                ? "bg-primary-tint border-primary text-on-primary-badge"
                : "bg-surface border-outline text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <Globe size={13} aria-hidden="true" />
            <span>Site Grabber (Crawler)</span>
          </button>
        </div>

        {/* Sub-mode 1: Paste URL List */}
        {mode === "urls" && (
          <div className="flex flex-col gap-2">
            <label
              htmlFor="hdm-batch-urls"
              className="font-label text-label-md text-on-surface"
            >
              Paste Direct Links, Magnets, or Model URLs (one per line)
            </label>
            <textarea
              id="hdm-batch-urls"
              rows={8}
              value={urlText}
              onChange={(e) => setUrlText(e.target.value)}
              placeholder={"https://example.com/archive-1.zip\nhttps://example.com/archive-2.zip\nmagnet:?xt=urn:btih:..."}
              className="w-full p-3 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary resize-y"
            />
            <span className="font-body text-body-sm text-on-surface-variant">
              Every valid HTTP, HTTPS, FTP, or magnet link found in the text will open in the batch selection checklist.
            </span>
          </div>
        )}

        {/* Sub-mode 2: URL Pattern */}
        {mode === "pattern" && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="hdm-batch-pattern"
                className="font-label text-label-md text-on-surface"
              >
                Numbered or Alphabetic URL Pattern
              </label>
              <input
                id="hdm-batch-pattern"
                type="text"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleParsePattern();
                  }
                }}
                placeholder="https://example.com/dataset/shard-[01..20].tar.gz"
                className="h-9 px-3 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary"
              />
            </div>

            <div className="rounded-md bg-surface border border-outline p-3 flex flex-col gap-1 font-mono text-mono-sm text-on-surface-variant">
              <span className="text-on-surface font-label text-label-sm uppercase tracking-wider">
                Supported Pattern Syntax
              </span>
              <span>• Zero-padded numbers: <span className="text-on-surface">[001..050]</span> or step <span className="text-on-surface">[1..100:5]</span></span>
              <span>• Letters: <span className="text-on-surface">[a..z]</span></span>
              <span>• Multiple ranges in one URL expand cleanly into a selectable batch list.</span>
            </div>
          </div>
        )}

        {/* Sub-mode 3: Site Grabber */}
        {mode === "grabber" && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={grabUrl}
                onChange={(e) => setGrabUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !crawling) {
                    e.preventDefault();
                    void handleStartGrabber();
                  }
                }}
                placeholder="https://example.com/downloads/"
                className="flex-1 h-9 px-3 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary"
              />
              {crawling ? (
                <button
                  type="button"
                  onClick={() => void handleStopGrabber()}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded bg-primary-tint border border-primary/40 font-label text-label-md text-on-primary-badge"
                >
                  <Square size={13} aria-hidden="true" />
                  <span>Stop ({pagesVisited}p)</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!grabUrl.trim()}
                  onClick={() => void handleStartGrabber()}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded bg-surface-container-high border border-outline font-label text-label-md text-on-surface hover:border-primary/40 disabled:opacity-40"
                >
                  <Play size={13} className="text-on-primary-badge" aria-hidden="true" />
                  <span>Crawl Site</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-12 gap-3">
              <label className="col-span-5 flex flex-col gap-1">
                <span className="font-label text-label-sm text-on-surface-variant">
                  Extensions (empty = all non-HTML files)
                </span>
                <input
                  type="text"
                  value={grabExts}
                  onChange={(e) => setGrabExts(e.target.value)}
                  placeholder="pdf, zip, mp4"
                  className="h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface focus:outline-none focus:border-primary"
                />
              </label>
              <label className="col-span-3 flex flex-col gap-1">
                <span className="font-label text-label-sm text-on-surface-variant">
                  Scope
                </span>
                <select
                  value={grabScope}
                  onChange={(e) => setGrabScope(e.target.value as GrabberScope)}
                  className="h-8 px-2 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface"
                >
                  <option value="sameHost">Same Host</option>
                  <option value="sameDomain">Same Domain</option>
                  <option value="subPath">Sub-Path Only</option>
                  <option value="any">Any Host</option>
                </select>
              </label>
              <label className="col-span-2 flex flex-col gap-1">
                <span className="font-label text-label-sm text-on-surface-variant">
                  Depth
                </span>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={grabDepth}
                  onChange={(e) => setGrabDepth(Number(e.target.value) || 1)}
                  className="h-8 px-2 rounded bg-surface border border-outline font-mono text-mono-sm tabular text-on-surface text-right"
                />
              </label>
              <label className="col-span-2 flex flex-col gap-1">
                <span className="font-label text-label-sm text-on-surface-variant">
                  Max Pages
                </span>
                <input
                  type="number"
                  min={10}
                  max={2000}
                  value={grabMaxPages}
                  onChange={(e) => setGrabMaxPages(Number(e.target.value) || 100)}
                  className="h-8 px-2 rounded bg-surface border border-outline font-mono text-mono-sm tabular text-on-surface text-right"
                />
              </label>
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeEmbedded}
                  onChange={(e) => setIncludeEmbedded(e.target.checked)}
                  className="accent-[#E11D2E]"
                />
                <span className="font-body text-body-sm text-on-surface-variant">
                  Include embedded media (&lt;img&gt;, &lt;video&gt;, &lt;audio&gt;)
                </span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={keepStructure}
                  onChange={(e) => setKeepStructure(e.target.checked)}
                  className="accent-[#E11D2E]"
                />
                <span className="font-body text-body-sm text-on-surface-variant">
                  Preserve site subfolder structure
                </span>
              </label>
            </div>

            {/* Discovered Files */}
            {(foundFiles.length > 0 || crawling) && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-mono text-mono-sm tabular text-on-surface-variant">
                    {crawling ? "Crawling… " : ""}
                    {pagesVisited} pages visited • {selectedUrls.size} / {foundFiles.length} files selected
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={fileFilter}
                      onChange={(e) => setFileFilter(e.target.value)}
                      placeholder="Filter found…"
                      className="h-7 w-40 px-2 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedUrls(new Set(filteredFiles.map((f) => f.url)))
                      }
                      className="h-7 px-2 rounded bg-surface-container-high border border-outline font-label text-label-sm text-on-surface"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedUrls(new Set())}
                      className="h-7 px-2 rounded bg-surface-container-high border border-outline font-label text-label-sm text-on-surface"
                    >
                      None
                    </button>
                  </div>
                </div>

                <div className="max-h-44 overflow-y-auto rounded-md bg-surface border border-outline divide-y divide-outline-subtle">
                  {filteredFiles.map((f) => {
                    const checked = selectedUrls.has(f.url);
                    return (
                      <label
                        key={f.url}
                        className="px-3 py-1.5 flex items-center justify-between gap-2 cursor-pointer hover:bg-surface-container-high"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedUrls((prev) => {
                                const next = new Set(prev);
                                if (next.has(f.url)) next.delete(f.url);
                                else next.add(f.url);
                                return next;
                              })
                            }
                            className="accent-[#E11D2E]"
                          />
                          <span className="font-mono text-mono-sm text-on-surface truncate">
                            {f.fileName || f.url}
                          </span>
                        </span>
                        <span className="font-mono text-mono-sm tabular text-on-surface-variant shrink-0">
                          {formatBytes(f.size)}
                        </span>
                      </label>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={saveDir}
                    onChange={(e) => setSaveDir(e.target.value)}
                    className="flex-1 h-8 px-3 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      void pickFolder(saveDir || defaultDir).then((p) => {
                        if (p) setSaveDir(p);
                      })
                    }
                    className="inline-flex items-center gap-1 h-8 px-3 rounded bg-surface-container-high border border-outline font-label text-label-sm text-on-surface"
                  >
                    <FolderOpen size={13} aria-hidden="true" />
                    <span>Browse</span>
                  </button>
                  {queues.length > 0 && (
                    <select
                      value={targetQueueId}
                      onChange={(e) => setTargetQueueId(e.target.value)}
                      className="h-8 px-2 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface"
                    >
                      <option value="">Start Immediately</option>
                      {queues.map((q) => (
                        <option key={q.id} value={q.id}>
                          Queue: {q.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {errorMsg && (
          <div className="rounded bg-primary-tint border border-primary/40 px-3 py-2 font-mono text-mono-sm text-on-primary-badge">
            {errorMsg}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3.5 border-t border-outline bg-surface flex items-center justify-between gap-3 shrink-0">
        <span className="font-mono text-mono-sm tabular text-on-surface-variant truncate">
          {mode === "grabber"
            ? `Free disk space: ${freeBytes != null ? formatBytes(freeBytes) : "—"}`
            : "Batch links open in a review checklist before starting"}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {mode === "urls" ? (
            <button
              type="button"
              disabled={!urlText.trim() || busy}
              onClick={() => void handleParseText()}
              className="inline-flex items-center gap-1.5 h-8 px-4 rounded bg-primary text-on-primary font-label text-label-md hover:bg-primary/90 disabled:opacity-40"
            >
              <ListPlus size={14} aria-hidden="true" />
              <span>{busy ? "Parsing…" : "Review Links"}</span>
            </button>
          ) : mode === "pattern" ? (
            <button
              type="button"
              disabled={!pattern.trim() || busy}
              onClick={() => void handleParsePattern()}
              className="inline-flex items-center gap-1.5 h-8 px-4 rounded bg-primary text-on-primary font-label text-label-md hover:bg-primary/90 disabled:opacity-40"
            >
              <Sparkles size={14} aria-hidden="true" />
              <span>{busy ? "Expanding…" : "Expand Pattern"}</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={!projectId || selectedUrls.size === 0 || downloading}
              onClick={() => void handleDownloadGrabbed({ type: "now" })}
              className="inline-flex items-center gap-1.5 h-8 px-4 rounded bg-primary text-on-primary font-label text-label-md hover:bg-primary/90 disabled:opacity-40"
            >
              <Download size={14} aria-hidden="true" />
              <span>
                {downloading
                  ? "Adding…"
                  : `Download ${selectedUrls.size} File(s)`}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
