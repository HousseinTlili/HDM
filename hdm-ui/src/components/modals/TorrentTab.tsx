import { useEffect, useRef, useState } from "react";
import { Download, FileUp, FolderOpen, RefreshCw } from "lucide-react";
import { useFreeSpace } from "../../hooks/useFreeSpace";
import { pickFile, pickFolder } from "../../lib/dialog";
import { formatBytes } from "../../lib/format";
import { ipc } from "../../lib/ipc";
import type { StartMode, TorrentMeta, TorrentSource } from "../../lib/types";
import { useDownloadsStore } from "../../store/downloadsStore";
import { useUiStore } from "../../store/uiStore";

interface TorrentTabProps {
  initialSource: string;
  onDone: () => void;
}

function looksLikeLocalTorrentPath(value: string): boolean {
  const lower = value.trim().toLowerCase();
  return (
    lower.endsWith(".torrent") &&
    !lower.startsWith("http://") &&
    !lower.startsWith("https://") &&
    !lower.startsWith("magnet:")
  );
}

export function TorrentTab({ initialSource, onDone }: TorrentTabProps) {
  const settings = useDownloadsStore((s) => s.settings);
  const categories = useDownloadsStore((s) => s.categories);
  const pushToast = useUiStore((s) => s.pushToast);

  const defaultDir = settings?.downloads.defaultDir ?? "";

  const [sourceText, setSourceText] = useState(initialSource);
  const [torrentSource, setTorrentSource] = useState<TorrentSource | null>(
    () =>
      initialSource.trim() && !looksLikeLocalTorrentPath(initialSource)
        ? { type: "url", value: initialSource.trim() }
        : null
  );
  const [meta, setMeta] = useState<TorrentMeta | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<number>>(
    () => new Set()
  );
  const [inspecting, setInspecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [saveDir, setSaveDir] = useState(defaultDir);
  const [category, setCategory] = useState("other");
  const freeBytes = useFreeSpace(saveDir);

  const runInspect = async (rawOrSource: string | TorrentSource) => {
    setErrorMsg(null);
    setInspecting(true);
    try {
      let src: TorrentSource;
      if (typeof rawOrSource === "string") {
        const trimmed = rawOrSource.trim();
        if (!trimmed) {
          setErrorMsg("Enter a magnet link or choose a .torrent file.");
          setInspecting(false);
          return;
        }
        src = looksLikeLocalTorrentPath(trimmed)
          ? await ipc.readTorrentFile(trimmed)
          : { type: "url", value: trimmed };
      } else {
        src = rawOrSource;
      }

      setTorrentSource(src);
      const inspected = await ipc.inspectTorrent(src);
      setMeta(inspected);
      setSelectedFiles(new Set(inspected.files.map((f) => f.index)));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setInspecting(false);
    }
  };

  const didAutoInspect = useRef(false);
  useEffect(() => {
    if (didAutoInspect.current) return;
    if (initialSource.trim()) {
      didAutoInspect.current = true;
      void runInspect(initialSource);
    }
  });

  const handleBrowseTorrentFile = async () => {
    const filePath = await pickFile([
      { name: "BitTorrent Metadata", extensions: ["torrent"] },
    ]);
    if (!filePath) return;
    setSourceText(filePath);
    try {
      const fileSource = await ipc.readTorrentFile(filePath);
      await runInspect(fileSource);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleBrowseSaveDir = async () => {
    const picked = await pickFolder(saveDir || defaultDir);
    if (picked) setSaveDir(picked);
  };

  const handleSubmit = async (mode: StartMode) => {
    if (submitting) return;
    setErrorMsg(null);
    setSubmitting(true);

    try {
      let src = torrentSource;
      if (!src) {
        const trimmed = sourceText.trim();
        if (!trimmed) {
          setErrorMsg("Enter a magnet link or load a .torrent file.");
          setSubmitting(false);
          return;
        }
        src = looksLikeLocalTorrentPath(trimmed)
          ? await ipc.readTorrentFile(trimmed)
          : { type: "url", value: trimmed };
      }

      let onlyFiles: number[] | null = null;
      let selectedTotal = meta?.totalSize;
      if (meta && meta.files.length > 0) {
        if (selectedFiles.size === 0) {
          setErrorMsg("Select at least one file from the torrent.");
          setSubmitting(false);
          return;
        }
        if (selectedFiles.size < meta.files.length) {
          onlyFiles = Array.from(selectedFiles).sort((a, b) => a - b);
          selectedTotal = meta.files
            .filter((f) => selectedFiles.has(f.index))
            .reduce((sum, f) => sum + f.size, 0);
        }
      }

      const fallbackName = meta?.name || sourceText.trim().slice(0, 64) || "Torrent";
      const added = await ipc.addTorrent({
        source: src,
        name: fallbackName,
        size: selectedTotal,
        onlyFiles,
        saveDir: saveDir.trim() || defaultDir,
        category,
        mode,
      });

      pushToast("success", `Added torrent ${added.fileName || fallbackName}`);
      onDone();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const selectedBytes = meta
    ? meta.files
        .filter((f) => selectedFiles.has(f.index))
        .reduce((sum, f) => sum + f.size, 0)
    : 0;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="p-5 flex flex-col gap-4 overflow-y-auto min-h-0">
        {/* Source Magnet / .torrent */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="hdm-torrent-source"
            className="font-label text-label-md text-on-surface"
          >
            Magnet URI or .torrent File
          </label>
          <div className="flex items-center gap-2">
            <input
              id="hdm-torrent-source"
              type="text"
              value={sourceText}
              onChange={(e) => {
                const v = e.target.value;
                setSourceText(v);
                setTorrentSource(
                  v.trim() && !looksLikeLocalTorrentPath(v)
                    ? { type: "url", value: v.trim() }
                    : null
                );
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void runInspect(sourceText);
                }
              }}
              placeholder="magnet:?xt=urn:btih:... or path to .torrent"
              className="flex-1 h-9 px-3 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => void handleBrowseTorrentFile()}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded bg-surface-container-high border border-outline font-label text-label-md text-on-surface hover:border-primary/40"
            >
              <FileUp size={14} className="text-on-surface-variant" aria-hidden="true" />
              <span>.torrent</span>
            </button>
            <button
              type="button"
              disabled={inspecting || !sourceText.trim()}
              onClick={() => void runInspect(sourceText)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded bg-surface-container-high border border-outline font-label text-label-md text-on-surface hover:border-primary/40 disabled:opacity-50"
            >
              <RefreshCw
                size={13}
                className={inspecting ? "animate-spin" : ""}
                aria-hidden="true"
              />
              <span>{inspecting ? "Loading…" : "Inspect"}</span>
            </button>
          </div>
        </div>

        {/* Torrent Metadata & File Checklist */}
        {meta && (
          <div className="rounded-md bg-surface border border-outline flex flex-col overflow-hidden">
            <div className="p-3.5 border-b border-outline flex items-start justify-between gap-3">
              <div className="min-w-0 flex flex-col gap-1">
                <span className="font-title text-title-md text-on-surface truncate">
                  {meta.name}
                </span>
                <span className="font-mono text-mono-sm text-on-surface-variant break-all">
                  {meta.infoHash}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono text-mono-sm tabular px-2 py-0.5 rounded-sm bg-surface-container border border-outline text-on-surface">
                  {formatBytes(selectedBytes)} / {formatBytes(meta.totalSize)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedFiles(new Set(meta.files.map((f) => f.index)))
                  }
                  className="h-6 px-2 rounded-sm bg-surface-container-high border border-outline font-label text-label-sm text-on-surface"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedFiles(new Set())}
                  className="h-6 px-2 rounded-sm bg-surface-container-high border border-outline font-label text-label-sm text-on-surface"
                >
                  None
                </button>
              </div>
            </div>

            <div className="max-h-48 overflow-y-auto divide-y divide-outline-subtle bg-surface-container">
              {meta.files.map((file) => {
                const checked = selectedFiles.has(file.index);
                return (
                  <label
                    key={file.index}
                    className="px-3 py-1.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-surface-container-high"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedFiles((prev) => {
                            const next = new Set(prev);
                            if (next.has(file.index)) next.delete(file.index);
                            else next.add(file.index);
                            return next;
                          })
                        }
                        className="accent-[#E11D2E]"
                      />
                      <span className="font-mono text-mono-sm text-on-surface truncate">
                        {file.path}
                      </span>
                    </span>
                    <span className="font-mono text-mono-sm tabular text-on-surface-variant shrink-0">
                      {formatBytes(file.size)}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Save Dir & Category */}
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-8 flex flex-col gap-1.5">
            <label
              htmlFor="hdm-torrent-savedir"
              className="font-label text-label-md text-on-surface"
            >
              Save Directory
            </label>
            <div className="flex items-center gap-2">
              <input
                id="hdm-torrent-savedir"
                type="text"
                value={saveDir}
                onChange={(e) => setSaveDir(e.target.value)}
                className="flex-1 h-8 px-3 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface focus:outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => void handleBrowseSaveDir()}
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

          <div className="col-span-4 flex flex-col gap-1.5">
            <label
              htmlFor="hdm-torrent-cat"
              className="font-label text-label-md text-on-surface"
            >
              Category
            </label>
            <select
              id="hdm-torrent-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface focus:outline-none focus:border-primary"
            >
              {categories.length > 0 ? (
                categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))
              ) : (
                <option value="other">Other</option>
              )}
            </select>
          </div>
        </div>

        {errorMsg && (
          <div className="rounded bg-primary-tint border border-primary/40 px-3 py-2 font-mono text-mono-sm text-on-primary-badge">
            {errorMsg}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3.5 border-t border-outline bg-surface flex items-center justify-between gap-3 shrink-0">
        <span className="font-mono text-mono-sm tabular text-on-surface-variant truncate">
          Free disk space: {freeBytes != null ? formatBytes(freeBytes) : "—"}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={submitting || (!torrentSource && !sourceText.trim())}
            onClick={() => void handleSubmit({ type: "later" })}
            className="h-8 px-3 rounded bg-surface-container-high border border-outline text-on-surface font-label text-label-md hover:border-primary/40 disabled:opacity-40"
          >
            Save Idle
          </button>
          <button
            type="button"
            disabled={submitting || (!torrentSource && !sourceText.trim())}
            onClick={() => void handleSubmit({ type: "now" })}
            className="inline-flex items-center gap-1.5 h-8 px-4 rounded bg-primary text-on-primary font-label text-label-md hover:bg-primary/90 disabled:opacity-40"
          >
            <Download size={14} aria-hidden="true" />
            <span>{submitting ? "Adding…" : "Start Torrent"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
