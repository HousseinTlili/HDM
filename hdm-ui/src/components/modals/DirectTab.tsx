import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileArchive,
  FolderOpen,
  Lock,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useFreeSpace } from "../../hooks/useFreeSpace";
import { pickFolder } from "../../lib/dialog";
import { formatBytes } from "../../lib/format";
import { ipc, onCoreEvent } from "../../lib/ipc";
import { detectProtocol } from "../../lib/protocol";
import type { ProtocolTab } from "../../lib/protocol";
import type {
  CaptureInfo,
  ConflictAction,
  SecurityScanReport,
  StartMode,
  ZipFile,
  ZipProgress,
} from "../../lib/types";
import { useDownloadsStore } from "../../store/downloadsStore";
import { useUiStore } from "../../store/uiStore";

interface DirectTabProps {
  initialUrl: string;
  initialCapture?: CaptureInfo;
  onCaptureIdChange: (id: string | null, manualUrl?: string) => void;
  onSwitchTab: (tab: ProtocolTab, nextUrl: string) => void;
  onDone: () => void;
}

const THREAD_OPTIONS = [
  { value: 32, label: "32 Threads (Max)" },
  { value: 16, label: "16 Threads" },
  { value: 8, label: "8 Threads (Recommended)" },
  { value: 4, label: "4 Threads" },
  { value: 1, label: "1 Thread (Sequential)" },
];

export function DirectTab({
  initialUrl,
  initialCapture,
  onCaptureIdChange,
  onSwitchTab,
  onDone,
}: DirectTabProps) {
  const settings = useDownloadsStore((s) => s.settings);
  const categories = useDownloadsStore((s) => s.categories);
  const queues = useDownloadsStore((s) => s.queues);
  const capturesById = useDownloadsStore((s) => s.capturesById);
  const removeCapture = useDownloadsStore((s) => s.removeCapture);
  const pushToast = useUiStore((s) => s.pushToast);

  const defaultDir = settings?.downloads.defaultDir ?? "";
  const defaultConnections = Math.min(
    32,
    Math.max(1, settings?.downloads.defaultConnections ?? 8)
  );
  const hfEndpoint = settings?.huggingFace.endpoint;

  const [url, setUrl] = useState(initialCapture?.url ?? initialUrl);
  const [capture, setCapture] = useState<CaptureInfo | null>(
    initialCapture ?? null
  );
  const [fileName, setFileName] = useState(initialCapture?.fileName ?? "");
  const [saveDir, setSaveDir] = useState(
    initialCapture?.saveDir || defaultDir
  );
  const [category, setCategory] = useState(initialCapture?.category || "other");
  const [connections, setConnections] = useState(defaultConnections);
  const [checksum, setChecksum] = useState("");
  const [priority, setPriority] = useState<"now" | "queue" | "later">("now");
  const [queueId, setQueueId] = useState(queues[0]?.id ?? "main");
  const [conflict, setConflict] = useState<ConflictAction>(
    settings?.downloads.conflict ?? "rename"
  );
  const [authOpen, setAuthOpen] = useState(Boolean(initialCapture?.needsAuth));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [fileNameEdited, setFileNameEdited] = useState(false);
  const [saveDirEdited, setSaveDirEdited] = useState(false);
  const [probingLocal, setProbingLocal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [zipOpen, setZipOpen] = useState(false);
  const [zipLoading, setZipLoading] = useState(false);
  const [zipFiles, setZipFiles] = useState<ZipFile[]>([]);
  const [zipFilter, setZipFilter] = useState("");
  const [zipError, setZipError] = useState<string | null>(null);
  const [extractingIndex, setExtractingIndex] = useState<number | null>(null);
  const [zipProgress, setZipProgress] = useState<ZipProgress | null>(null);
  const [preScan, setPreScan] = useState<SecurityScanReport | null>(null);

  useEffect(() => {
    const trimmedUrl = url.trim();
    const trimmedName = fileName.trim();
    if (!trimmedUrl && !trimmedName) {
      setPreScan(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void ipc
        .scanDownloadUrl(trimmedUrl, trimmedName || undefined)
        .then((report) => {
          if (alive) setPreScan(report.verdict === "clean" ? null : report);
        })
        .catch(() => {
          if (alive) setPreScan(null);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [url, fileName]);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    void onCoreEvent((ev) => {
      if (!alive || ev.type !== "zipProgress") return;
      if (activeCaptureIdRef.current && ev.payload.captureId === activeCaptureIdRef.current) {
        setZipProgress(ev.payload);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  const freeBytes = useFreeSpace(saveDir);
  const activeCaptureIdRef = useRef<string | null>(initialCapture?.id ?? null);

  // Sync live updates from CoreEvent::CaptureRequested / CaptureUpdated
  const liveCapture = capture?.id ? capturesById[capture.id] ?? capture : null;

  useEffect(() => {
    if (!initialCapture) return;
    activeCaptureIdRef.current = initialCapture.id;
    onCaptureIdChange(initialCapture.id, initialCapture.url);
    setCapture(initialCapture);
    setUrl(initialCapture.url);
    if (!fileNameEdited) setFileName(initialCapture.fileName);
    if (!saveDirEdited && initialCapture.saveDir) setSaveDir(initialCapture.saveDir);
    if (initialCapture.category) setCategory(initialCapture.category);
    if (initialCapture.needsAuth) setAuthOpen(true);
  }, [initialCapture, onCaptureIdChange, fileNameEdited, saveDirEdited]);

  useEffect(() => {
    if (!liveCapture) return;
    if (!fileNameEdited && liveCapture.fileName) {
      setFileName(liveCapture.fileName);
    }
    if (!saveDirEdited && liveCapture.saveDir) {
      setSaveDir(liveCapture.saveDir);
    }
    if (liveCapture.category) setCategory(liveCapture.category);
    if (liveCapture.needsAuth) setAuthOpen(true);
  }, [liveCapture, fileNameEdited, saveDirEdited]);

  const startProbe = async (targetUrl: string): Promise<CaptureInfo | null> => {
    const trimmed = targetUrl.trim();
    if (!trimmed) {
      setErrorMsg("Enter a download URL.");
      return null;
    }

    const detected = detectProtocol(trimmed, hfEndpoint);
    if (detected !== "direct") {
      onSwitchTab(detected, trimmed);
      return null;
    }

    setErrorMsg(null);
    setProbingLocal(true);
    setZipFiles([]);
    setZipError(null);

    if (activeCaptureIdRef.current) {
      const prevId = activeCaptureIdRef.current;
      activeCaptureIdRef.current = null;
      onCaptureIdChange(null);
      void ipc.cancelCapture(prevId).catch(() => {});
      removeCapture(prevId);
    }

    try {
      onCaptureIdChange(null, trimmed);
      const info = await ipc.addUrl({
        url: trimmed,
        username: username.trim() || undefined,
        password: username.trim() ? password : undefined,
      });

      if (info.kind === "torrent") {
        onSwitchTab("torrent", trimmed);
        return null;
      }
      if (info.kind === "video") {
        onSwitchTab("video", trimmed);
        return null;
      }
      if (!info.saveDir && detectProtocol(trimmed, hfEndpoint) === "huggingface") {
        onSwitchTab("huggingface", trimmed);
        return null;
      }

      activeCaptureIdRef.current = info.id;
      onCaptureIdChange(info.id, trimmed);
      setCapture(info);
      setFileNameEdited(false);
      setSaveDirEdited(false);
      setFileName(info.fileName);
      setSaveDir(info.saveDir || defaultDir);
      setCategory(info.category || "other");
      if (info.needsAuth) setAuthOpen(true);
      return info;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setProbingLocal(false);
    }
  };

  // Auto-probe when opened with an HTTP/FTP URL (but NOT when opened with a browser CaptureInfo)
  const autoProbedRef = useRef(false);
  useEffect(() => {
    if (autoProbedRef.current) return;
    if (!initialCapture && initialUrl.trim()) {
      autoProbedRef.current = true;
      void startProbe(initialUrl);
    }
  });

  const handleBrowseFolder = async () => {
    const picked = await pickFolder(saveDir || defaultDir);
    if (picked) {
      setSaveDirEdited(true);
      setSaveDir(picked);
    }
  };

  const handleCategoryChange = (nextCat: string) => {
    setCategory(nextCat);
    if (!saveDirEdited && settings?.downloads.useCategoryFolders) {
      const cat = categories.find((c) => c.id === nextCat);
      if (cat?.saveDir) {
        setSaveDir(cat.saveDir);
      } else if (defaultDir) {
        setSaveDir(defaultDir);
      }
    }
  };

  const handleReprobe = async () => {
    if (!liveCapture) {
      await startProbe(url);
      return;
    }
    setErrorMsg(null);
    try {
      await ipc.reprobeCapture(
        liveCapture.id,
        username.trim() || undefined,
        password
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const explainZipError = (raw: string): string => {
    switch (raw) {
      case "zip:noRanges":
        return "Server does not support HTTP range requests, so remote ZIP peeking is unavailable.";
      case "zip:notZip":
        return "This file does not appear to be a valid ZIP archive.";
      case "zip:protected":
        return "Archive directory is encrypted or password-protected.";
      default:
        return raw;
    }
  };

  const handleLoadZip = async () => {
    if (!liveCapture) return;
    setZipOpen(true);
    setZipLoading(true);
    setZipError(null);
    setZipFilter("");
    try {
      const files = await ipc.zipContents(liveCapture.id);
      setZipFiles(files);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setZipError(explainZipError(msg));
    } finally {
      setZipLoading(false);
    }
  };

  const handleExtractZipFile = async (entry: ZipFile) => {
    if (!liveCapture || extractingIndex !== null) return;
    setExtractingIndex(entry.index);
    setZipProgress({
      captureId: liveCapture.id,
      index: entry.index,
      done: 0,
      total: entry.size,
    });
    try {
      const target = saveDir.trim() || defaultDir;
      const savedPath = await ipc.extractZipFile(
        liveCapture.id,
        entry.index,
        target
      );
      pushToast("success", `Extracted ${entry.path} to ${savedPath}`);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setExtractingIndex(null);
      setZipProgress(null);
    }
  };

  const handleCancelZipExtract = async (index: number) => {
    if (!liveCapture) return;
    await ipc.cancelZipFile(liveCapture.id, index).catch(() => {});
  };

  const confirmWithMode = async (modeOverride?: StartMode) => {
    if (submitting) return;
    setErrorMsg(null);
    setSubmitting(true);

    try {
      let targetCapture = liveCapture;
      if (!targetCapture || targetCapture.url.trim() !== url.trim()) {
        targetCapture = await startProbe(url);
        if (!targetCapture) {
          setSubmitting(false);
          return;
        }
      }

      const chosenMode: StartMode =
        modeOverride ??
        (priority === "now"
          ? { type: "now" }
          : priority === "later"
          ? { type: "later" }
          : { type: "queue", queueId: queueId || "main" });

      const confirmed = await ipc.hdmConfirmCapture({
        id: targetCapture.id,
        fileName: fileName.trim() || targetCapture.fileName,
        saveDir: saveDir.trim() || targetCapture.saveDir || defaultDir,
        category: category || targetCapture.category,
        mode: chosenMode,
        username: username.trim() || undefined,
        password: username.trim() ? password : undefined,
        conflict: conflict === "ask" ? "rename" : conflict,
        connections: Math.min(32, Math.max(1, connections)),
        checksum: checksum.trim() || undefined,
      });

      activeCaptureIdRef.current = null;
      onCaptureIdChange(null);
      removeCapture(targetCapture.id);
      pushToast(
        "success",
        chosenMode.type === "now"
          ? `Started ${confirmed.fileName}`
          : `Added ${confirmed.fileName}`
      );
      onDone();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const isHfDirect =
    url.toLowerCase().includes("huggingface.co") ||
    url.toLowerCase().includes("hf-mirror.com") ||
    url.toLowerCase().includes("hf.co");
  const isProbing = probingLocal || Boolean(liveCapture?.probing);
  const lowerName = (fileName || liveCapture?.fileName || "").toLowerCase();
  const isZipName =
    /\.(zip|whl|jar|apk|epub|docx|xlsx|pptx)$/.test(lowerName) ||
    Boolean(liveCapture?.mime?.toLowerCase().includes("zip"));
  const filteredZipFiles = zipFilter.trim()
    ? zipFiles.filter((f) =>
        f.path.toLowerCase().includes(zipFilter.trim().toLowerCase())
      )
    : zipFiles;
  const totalZipBytes = zipFiles.reduce((sum, f) => sum + f.size, 0);

  const statusPill = isProbing
    ? {
        label: "Probing server headers…",
        cls: "bg-surface border-outline text-on-surface-variant",
      }
    : liveCapture?.needsAuth
    ? {
        label: "Authentication Required",
        cls: "bg-status-warning-tint border-status-warning/30 text-status-warning",
      }
    : liveCapture?.probeError
    ? {
        label: liveCapture.probeError,
        cls: "bg-primary-tint border-primary/40 text-on-primary-badge",
      }
    : liveCapture?.resumable === true
    ? {
        label: isHfDirect
          ? "HF-LFS Detected • Range Supported"
          : "Range Supported • Multi-Segment Ready",
        cls: "bg-status-connected-tint border-status-connected/30 text-status-connected",
      }
    : liveCapture?.resumable === false
    ? {
        label: "Single Stream (Resume Unsupported)",
        cls: "bg-status-warning-tint border-status-warning/30 text-status-warning",
      }
    : null;

  const connSelectOptions = THREAD_OPTIONS.some((o) => o.value === connections)
    ? THREAD_OPTIONS
    : [
        ...THREAD_OPTIONS,
        { value: connections, label: `${connections} Threads` },
      ].sort((a, b) => b.value - a.value);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="p-5 flex flex-col gap-4 overflow-y-auto min-h-0">
        {/* Source URL */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="hdm-direct-url"
              className="font-label text-label-md text-on-surface"
            >
              Source URL
            </label>
            {statusPill && (
              <span
                className={`font-mono text-mono-sm px-2 py-0.5 rounded-sm border truncate max-w-md ${statusPill.cls}`}
              >
                {statusPill.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              id="hdm-direct-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text").trim();
                if (!pasted) return;
                const detected = detectProtocol(pasted, hfEndpoint);
                if (detected !== "direct") {
                  e.preventDefault();
                  onSwitchTab(detected, pasted);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void startProbe(url);
                }
              }}
              placeholder="https://example.com/file.iso"
              className="flex-1 h-9 px-3 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary"
            />
            <button
              type="button"
              disabled={isProbing || !url.trim()}
              onClick={() => void startProbe(url)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded bg-surface-container-high border border-outline font-label text-label-md text-on-surface hover:border-primary/40 disabled:opacity-50"
            >
              <RefreshCw
                size={13}
                className={isProbing ? "animate-spin" : ""}
                aria-hidden="true"
              />
              <span>Probe</span>
            </button>
          </div>
        </div>

        {/* Detected Metadata Card (4 Columns) */}
        <div className="rounded-md bg-surface border border-outline p-3.5 grid grid-cols-12 gap-3">
          <div className="col-span-5 flex flex-col gap-1 min-w-0">
            <label
              htmlFor="hdm-direct-filename"
              className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant"
            >
              Filename
            </label>
            <input
              id="hdm-direct-filename"
              type="text"
              value={fileName}
              onChange={(e) => {
                setFileNameEdited(true);
                setFileName(e.target.value);
              }}
              placeholder="Auto-detected from server"
              className="h-7 px-2 rounded bg-surface-container border border-outline font-mono text-mono-sm text-on-surface focus:outline-none focus:border-primary"
            />
          </div>

          <div className="col-span-2 flex flex-col gap-1">
            <span className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
              Total Size
            </span>
            <span className="font-mono text-mono-md tabular text-on-surface h-7 flex items-center">
              {formatBytes(liveCapture?.size)}
            </span>
          </div>

          <div className="col-span-3 flex flex-col gap-1">
            <label
              htmlFor="hdm-direct-category"
              className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant"
            >
              Category
            </label>
            <select
              id="hdm-direct-category"
              value={category}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className="h-7 px-2 rounded bg-surface-container border border-outline font-mono text-mono-sm text-on-surface focus:outline-none focus:border-primary"
            >
              {categories.length > 0 ? (
                categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))
              ) : (
                <option value={category}>{category}</option>
              )}
            </select>
          </div>

          <div className="col-span-2 flex flex-col gap-1">
            <span className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
              Disk Status
            </span>
            <span
              className={`font-mono text-mono-sm h-7 flex items-center ${
                liveCapture?.exists ? "text-status-warning" : "text-status-connected"
              }`}
            >
              {liveCapture?.exists ? "File Exists" : "Ready"}
            </span>
          </div>
        </div>

        {/* Save Directory & Parallel Segments */}
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-8 flex flex-col gap-1.5">
            <label
              htmlFor="hdm-direct-savedir"
              className="font-label text-label-md text-on-surface"
            >
              Save Directory
            </label>
            <div className="flex items-center gap-2">
              <input
                id="hdm-direct-savedir"
                type="text"
                value={saveDir}
                onChange={(e) => {
                  setSaveDirEdited(true);
                  setSaveDir(e.target.value);
                }}
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

          <div className="col-span-4 flex flex-col gap-1.5">
            <label
              htmlFor="hdm-direct-segments"
              className="font-label text-label-md text-on-surface"
            >
              Parallel Segments
            </label>
            <select
              id="hdm-direct-segments"
              value={connections}
              onChange={(e) => setConnections(Number(e.target.value))}
              className="h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface focus:outline-none focus:border-primary"
            >
              {connSelectOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Checksum & Queue / Conflict */}
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-6 flex flex-col gap-1.5">
            <label
              htmlFor="hdm-direct-checksum"
              className="font-label text-label-md text-on-surface"
            >
              Expected Checksum (Optional SHA-256)
            </label>
            <input
              id="hdm-direct-checksum"
              type="text"
              value={checksum}
              onChange={(e) => setChecksum(e.target.value)}
              placeholder="sha256:..."
              className="w-full h-8 px-3 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary"
            />
          </div>

          <div className="col-span-3 flex flex-col gap-1.5">
            <label
              htmlFor="hdm-direct-priority"
              className="font-label text-label-md text-on-surface"
            >
              Start Mode
            </label>
            <select
              id="hdm-direct-priority"
              value={priority}
              onChange={(e) =>
                setPriority(e.target.value as "now" | "queue" | "later")
              }
              className="h-8 px-2.5 rounded bg-surface border border-outline font-label text-label-md text-on-surface focus:outline-none focus:border-primary"
            >
              <option value="now">Start Immediately</option>
              <option value="queue">Add to Queue</option>
              <option value="later">Save Idle</option>
            </select>
          </div>

          <div className="col-span-3 flex flex-col gap-1.5">
            <label
              htmlFor="hdm-direct-conflict"
              className="font-label text-label-md text-on-surface"
            >
              If Exists
            </label>
            <select
              id="hdm-direct-conflict"
              value={conflict === "ask" ? "rename" : conflict}
              onChange={(e) => setConflict(e.target.value as ConflictAction)}
              className="h-8 px-2.5 rounded bg-surface border border-outline font-label text-label-md text-on-surface focus:outline-none focus:border-primary"
            >
              <option value="rename">Auto-Rename</option>
              <option value="overwrite">Overwrite</option>
            </select>
          </div>
        </div>

        {priority === "queue" && queues.length > 0 && (
          <div className="flex items-center gap-3">
            <label
              htmlFor="hdm-direct-queue"
              className="font-label text-label-sm text-on-surface-variant"
            >
              Target Queue:
            </label>
            <select
              id="hdm-direct-queue"
              value={queueId}
              onChange={(e) => setQueueId(e.target.value)}
              className="h-7 px-2 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface focus:outline-none focus:border-primary"
            >
              {queues.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Expandable Auth + ZIP Peek Row */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => setAuthOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 font-label text-label-sm text-on-surface-variant hover:text-on-surface"
          >
            {authOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Lock size={12} aria-hidden="true" />
            <span>Server Credentials (Basic Auth)</span>
          </button>

          {isZipName && liveCapture && (
            <button
              type="button"
              onClick={() => void handleLoadZip()}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded bg-primary-tint border border-primary/40 font-label text-label-sm text-on-primary-badge hover:bg-primary/20"
            >
              <FileArchive size={12} aria-hidden="true" />
              <span>Peek Inside ZIP (Extract Single File)</span>
            </button>
          )}
        </div>

        {authOpen && (
          <div className="rounded-md bg-surface border border-outline p-3 grid grid-cols-12 gap-3 items-end">
            <label className="col-span-5 flex flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">
                Username
              </span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-7 px-2 rounded bg-surface-container border border-outline font-mono text-mono-sm text-on-surface focus:outline-none focus:border-primary"
              />
            </label>
            <label className="col-span-5 flex flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">
                Password
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-7 px-2 rounded bg-surface-container border border-outline font-mono text-mono-sm text-on-surface focus:outline-none focus:border-primary"
              />
            </label>
            <button
              type="button"
              onClick={() => void handleReprobe()}
              className="col-span-2 h-7 px-2 rounded bg-surface-container-high border border-outline font-label text-label-sm text-on-surface hover:border-primary/40"
            >
              Re-probe
            </button>
          </div>
        )}

        {zipOpen && (
          <div className="rounded-md bg-surface border border-outline p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
                Remote ZIP Contents
                {zipFiles.length > 0
                  ? ` (${zipFiles.length} files · ${formatBytes(totalZipBytes)} unpacked)`
                  : ""}
              </span>
              <button
                type="button"
                onClick={() => setZipOpen(false)}
                className="font-label text-label-sm text-on-surface-variant hover:text-on-surface"
              >
                Hide
              </button>
            </div>
            {!zipLoading && !zipError && zipFiles.length > 5 && (
              <input
                type="text"
                value={zipFilter}
                onChange={(e) => setZipFilter(e.target.value)}
                placeholder="Filter files inside archive…"
                className="h-7 px-2.5 rounded bg-surface-container border border-outline font-mono text-mono-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary"
              />
            )}
            {zipLoading ? (
              <span className="font-mono text-mono-sm text-on-surface-variant">
                Reading remote central directory over HTTP Range…
              </span>
            ) : zipError ? (
              <span className="font-mono text-mono-sm text-on-primary-badge">
                {zipError}
              </span>
            ) : (
              <div className="max-h-44 overflow-y-auto divide-y divide-outline-subtle border border-outline rounded bg-surface-container">
                {filteredZipFiles.map((entry) => {
                  const isExtracting = extractingIndex === entry.index;
                  const pct =
                    isExtracting && zipProgress && zipProgress.total > 0
                      ? Math.min(100, Math.round((zipProgress.done / zipProgress.total) * 100))
                      : null;
                  return (
                    <div
                      key={entry.index}
                      className="px-2.5 py-1.5 flex items-center justify-between gap-2"
                    >
                      <span className="font-mono text-mono-sm text-on-surface truncate">
                        {entry.path}
                        {entry.encrypted ? " 🔒" : ""}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-mono-sm tabular text-on-surface-variant">
                          {formatBytes(entry.size)}
                        </span>
                        {isExtracting ? (
                          <button
                            type="button"
                            onClick={() => void handleCancelZipExtract(entry.index)}
                            className="h-6 px-2 rounded-sm bg-primary-tint border border-primary/40 font-mono text-mono-sm text-on-primary-badge"
                          >
                            {pct != null ? `${pct}% · Cancel` : "Cancel"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={!entry.extractable || extractingIndex !== null}
                            onClick={() => void handleExtractZipFile(entry)}
                            className="h-6 px-2 rounded-sm bg-surface-container-high border border-outline font-label text-label-sm text-on-surface hover:border-primary/50 disabled:opacity-40"
                          >
                            {entry.extractable ? "Extract" : "Unsupported"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {preScan && preScan.findings.length > 0 && (
          <div
            className={`rounded border px-3 py-2.5 flex flex-col gap-1 ${
              preScan.verdict === "harmful"
                ? "bg-primary-tint border-primary/50"
                : "bg-status-warning-tint border-status-warning/40"
            }`}
          >
            <div className="flex items-center gap-1.5">
              <ShieldAlert
                size={14}
                className={
                  preScan.verdict === "harmful"
                    ? "text-on-primary-badge shrink-0"
                    : "text-status-warning shrink-0"
                }
                aria-hidden="true"
              />
              <span
                className={`font-label text-label-md ${
                  preScan.verdict === "harmful"
                    ? "text-on-primary-badge"
                    : "text-status-warning"
                }`}
              >
                Malware Guard:{" "}
                {preScan.verdict === "harmful"
                  ? "Harmful delivery pattern detected"
                  : "High-risk script/shortcut file"}
              </span>
            </div>
            {preScan.findings.map((f, idx) => (
              <p
                key={idx}
                className="font-body text-body-sm text-on-surface-variant"
              >
                <strong className="text-on-surface">{f.title}:</strong> {f.detail}
              </p>
            ))}
            <span className="font-mono text-mono-sm text-on-surface-variant">
              Advisory only — you decide whether to click Start Download or cancel.
            </span>
          </div>
        )}

        {errorMsg && (
          <div className="rounded bg-primary-tint border border-primary/40 px-3 py-2 font-mono text-mono-sm text-on-primary-badge">
            {errorMsg}
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="px-5 py-3.5 border-t border-outline bg-surface flex items-center justify-between gap-3 shrink-0">
        <span className="font-mono text-mono-sm tabular text-on-surface-variant truncate">
          Free disk space: {freeBytes != null ? formatBytes(freeBytes) : "—"}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={submitting || !url.trim()}
            onClick={() =>
              void confirmWithMode({
                type: "queue",
                queueId: queueId || "main",
              })
            }
            className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded bg-surface-container-high border border-outline text-on-surface font-label text-label-md hover:border-primary/40 disabled:opacity-50"
          >
            Add to Queue
          </button>
          <button
            type="button"
            disabled={submitting || !url.trim()}
            onClick={() => void confirmWithMode({ type: "now" })}
            className="inline-flex items-center justify-center gap-1.5 h-8 px-4 rounded bg-primary text-on-primary font-label text-label-md hover:bg-primary/90 disabled:opacity-50"
          >
            <Download size={14} aria-hidden="true" />
            <span>{submitting ? "Starting…" : "Start Download"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
