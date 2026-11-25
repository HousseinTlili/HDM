import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Cpu, Download, FolderOpen, Layers, Link2, MonitorPlay, Share2, Terminal } from "lucide-react";
import { useFreeSpace } from "../../hooks/useFreeSpace";
import { pickFolder } from "../../lib/dialog";
import { formatBytes } from "../../lib/format";
import { ipc } from "../../lib/ipc";
import { detectProtocol } from "../../lib/protocol";
import type { ProtocolTab } from "../../lib/protocol";
import type { BatchInfo, HdmIntent } from "../../lib/types";
import { useDownloadsStore } from "../../store/downloadsStore";
import { useUiStore } from "../../store/uiStore";
import { BatchGrabberTab } from "./BatchGrabberTab";
import { DirectTab } from "./DirectTab";
import { HuggingFaceTab } from "./HuggingFaceTab";
import { OllamaTab } from "./OllamaTab";
import { TorrentTab } from "./TorrentTab";
import { VideoTab } from "./VideoTab";

function BatchPanel({
  batch,
  onDone,
}: {
  batch: BatchInfo;
  onDone: () => void;
}) {
  const defaultDir = useDownloadsStore(
    (s) => s.settings?.downloads.defaultDir ?? ""
  );
  const pushToast = useUiStore((s) => s.pushToast);

  const [saveDir, setSaveDir] = useState(defaultDir);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(
    () => new Set(batch.entries.map((e) => e.url))
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const freeBytes = useFreeSpace(saveDir);

  const handleBrowse = async () => {
    const picked = await pickFolder(saveDir || defaultDir);
    if (picked) setSaveDir(picked);
  };

  const handleConfirm = async (startNow: boolean) => {
    const urls = Array.from(selectedUrls);
    if (urls.length === 0 || submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const count = await ipc.confirmBatch({
        id: batch.id,
        urls,
        saveDir: saveDir.trim() || defaultDir,
        mode: startNow ? { type: "now" } : { type: "later" },
      });
      pushToast("success", `Added ${count} batch download(s)`);
      onDone();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="p-5 flex flex-col gap-4 overflow-y-auto min-h-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-title text-title-md text-on-surface">
              {batch.title}
            </h2>
            <span className="font-mono text-mono-sm text-on-surface-variant">
              {selectedUrls.size} / {batch.entries.length} links selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setSelectedUrls(new Set(batch.entries.map((e) => e.url)))
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

        <div className="max-h-56 overflow-y-auto rounded-md bg-surface border border-outline divide-y divide-outline-subtle">
          {batch.entries.map((entry) => {
            const checked = selectedUrls.has(entry.url);
            return (
              <label
                key={entry.url}
                className="px-3 py-2 flex items-center justify-between gap-2 cursor-pointer hover:bg-surface-container-high"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setSelectedUrls((prev) => {
                        const next = new Set(prev);
                        if (next.has(entry.url)) next.delete(entry.url);
                        else next.add(entry.url);
                        return next;
                      })
                    }
                    className="accent-[#E11D2E]"
                  />
                  <span className="font-mono text-mono-sm text-on-surface truncate">
                    {entry.fileName || entry.url}
                  </span>
                </span>
                <span className="font-mono text-mono-sm tabular text-on-surface-variant shrink-0">
                  {formatBytes(entry.size)}
                </span>
              </label>
            );
          })}
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="hdm-batch-dir"
            className="font-label text-label-md text-on-surface"
          >
            Save Directory
          </label>
          <div className="flex items-center gap-2">
            <input
              id="hdm-batch-dir"
              type="text"
              value={saveDir}
              onChange={(e) => setSaveDir(e.target.value)}
              className="flex-1 h-8 px-3 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface focus:outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => void handleBrowse()}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-surface-container-high border border-outline font-label text-label-md text-on-surface hover:border-primary/40"
            >
              <FolderOpen size={14} className="text-on-surface-variant" aria-hidden="true" />
              <span>Browse</span>
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="rounded bg-primary-tint border border-primary/40 px-3 py-2 font-mono text-mono-sm text-on-primary-badge">
            {errorMsg}
          </div>
        )}
      </div>

      <div className="px-5 py-3.5 border-t border-outline bg-surface flex items-center justify-between gap-3 shrink-0">
        <span className="font-mono text-mono-sm tabular text-on-surface-variant">
          Free disk space: {freeBytes != null ? formatBytes(freeBytes) : "—"}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={selectedUrls.size === 0 || submitting}
            onClick={() => void handleConfirm(false)}
            className="h-8 px-3 rounded bg-surface-container-high border border-outline text-on-surface font-label text-label-md hover:border-primary/40 disabled:opacity-40"
          >
            Save Idle
          </button>
          <button
            type="button"
            disabled={selectedUrls.size === 0 || submitting}
            onClick={() => void handleConfirm(true)}
            className="inline-flex items-center gap-1.5 h-8 px-4 rounded bg-primary text-on-primary font-label text-label-md hover:bg-primary/90 disabled:opacity-40"
          >
            <Download size={14} aria-hidden="true" />
            <span>{submitting ? "Starting…" : "Start All"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

const PROTOCOL_TABS: {
  id: ProtocolTab;
  label: string;
  icon: typeof Link2;
}[] = [
  { id: "direct", label: "Direct HTTP/FTP", icon: Link2 },
  { id: "video", label: "Video (yt-dlp)", icon: MonitorPlay },
  { id: "torrent", label: "Torrent", icon: Share2 },
  { id: "ollama", label: "Ollama", icon: Terminal },
  { id: "huggingface", label: "Hugging Face", icon: Cpu },
  { id: "batch", label: "Batch / Grabber", icon: Layers },
];

function resolveTabFromIntent(intent: HdmIntent, hfEndpoint?: string): ProtocolTab {
  switch (intent.kind) {
    case "video":
      return "video";
    case "torrent":
      return "torrent";
    case "ollama":
      return "ollama";
    case "model":
      return intent.provider === "ollama" ? "ollama" : "huggingface";
    case "capture":
      return "direct";
    case "new":
      return detectProtocol(intent.url ?? "", hfEndpoint);
    case "batch":
      return "direct";
  }
}

function resolveInitialUrl(intent: HdmIntent): string {
  switch (intent.kind) {
    case "new":
      return intent.url ?? "";
    case "capture":
      return intent.info.url;
    case "video":
      return intent.info.pageUrl;
    case "torrent":
      return intent.source;
    case "ollama":
      return intent.model ?? "";
    case "model":
      return intent.source;
    case "batch":
      return "";
  }
}

export function AddDownloadModal() {
  const pendingIntent = useUiStore((s) => s.pendingIntent);
  const setPendingIntent = useUiStore((s) => s.setPendingIntent);
  const removeCapture = useDownloadsStore((s) => s.removeCapture);
  const hfEndpoint = useDownloadsStore((s) => s.settings?.huggingFace.endpoint);

  if (!pendingIntent) return null;

  return (
    <AddDownloadDialog
      intent={pendingIntent}
      hfEndpoint={hfEndpoint}
      onClose={() => setPendingIntent(null)}
      onForgetCapture={removeCapture}
    />
  );
}

function AddDownloadDialog({
  intent,
  hfEndpoint,
  onClose,
  onForgetCapture,
}: {
  intent: HdmIntent;
  hfEndpoint?: string;
  onClose: () => void;
  onForgetCapture: (id: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<ProtocolTab>(() =>
    resolveTabFromIntent(intent, hfEndpoint)
  );
  const [tabUrl, setTabUrl] = useState<string>(() => resolveInitialUrl(intent));
  const [createdBatch, setCreatedBatch] = useState<BatchInfo | null>(
    intent.kind === "batch" ? intent.info : null
  );

  const ownedCaptureIdRef = useRef<string | null>(
    intent.kind === "capture" ? intent.info.id : null
  );
  const manualProbeUrlRef = useRef<string | null>(null);
  const ownedVideoIdRef = useRef<string | null>(
    intent.kind === "video" ? intent.info.id : null
  );
  const activeBatchId = createdBatch?.id ?? (intent.kind === "batch" ? intent.info.id : null);

  const [adoptedCapture, setAdoptedCapture] = useState(
    intent.kind === "capture" ? intent.info : undefined
  );
  const [adoptedVideo, setAdoptedVideo] = useState(
    intent.kind === "video" ? intent.info : undefined
  );

  // Sync incoming intents while dialog is already open without resetting manual probes on echo
  useEffect(() => {
    if (intent.kind === "capture") {
      const incoming = intent.info;
      if (
        incoming.id === ownedCaptureIdRef.current ||
        (manualProbeUrlRef.current && incoming.url === manualProbeUrlRef.current)
      ) {
        ownedCaptureIdRef.current = incoming.id;
        return;
      }
      ownedCaptureIdRef.current = incoming.id;
      setAdoptedCapture(incoming);
      setTabUrl(incoming.url);
      setActiveTab("direct");
      return;
    }

    if (intent.kind === "video") {
      ownedVideoIdRef.current = intent.info.id;
      setAdoptedVideo(intent.info);
      setTabUrl(intent.info.pageUrl);
      setActiveTab("video");
      return;
    }

    if (intent.kind === "torrent") {
      setTabUrl(intent.source);
      setActiveTab("torrent");
      return;
    }

    if (intent.kind === "ollama") {
      setTabUrl(intent.model ?? "");
      setActiveTab("ollama");
      return;
    }

    if (intent.kind === "model") {
      setTabUrl(intent.source);
      setActiveTab(intent.provider === "ollama" ? "ollama" : "huggingface");
      return;
    }

    if (intent.kind === "new" && intent.url) {
      setTabUrl(intent.url);
      setActiveTab(detectProtocol(intent.url, hfEndpoint));
    }
  }, [intent, hfEndpoint]);

  const cleanupPendingAndClose = useCallback(
    (skipCancel = false) => {
      if (!skipCancel) {
        if (ownedCaptureIdRef.current) {
          const capId = ownedCaptureIdRef.current;
          ownedCaptureIdRef.current = null;
          void ipc.cancelCapture(capId).catch(() => {});
          onForgetCapture(capId);
        }
        if (ownedVideoIdRef.current) {
          const vidId = ownedVideoIdRef.current;
          ownedVideoIdRef.current = null;
          void ipc.cancelVideo(vidId).catch(() => {});
        }
        if (activeBatchId) {
          void ipc.cancelBatch(activeBatchId).catch(() => {});
        }
      }
      onClose();
    },
    [activeBatchId, onClose, onForgetCapture]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cleanupPendingAndClose(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [cleanupPendingAndClose]);

  const handleSwitchTab = useCallback(
    (nextTab: ProtocolTab, nextUrl?: string) => {
      if (nextUrl !== undefined) setTabUrl(nextUrl);
      setActiveTab(nextTab);
    },
    []
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="hdm-add-dialog-title"
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) cleanupPendingAndClose(false);
      }}
    >
      <div className="w-full max-w-3xl max-h-[88vh] bg-surface-container border border-outline rounded-md flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-outline flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-primary-badge border border-primary/40 flex items-center justify-center shrink-0">
              <Download size={16} className="text-on-primary-badge" aria-hidden="true" />
            </div>
            <div className="flex flex-col">
              <h1
                id="hdm-add-dialog-title"
                className="font-title text-title-lg text-on-surface"
              >
                {intent.kind === "batch" ? "Batch Download" : "New Download"}
              </h1>
              <span className="font-body text-body-sm text-on-surface-variant">
                Auto-parsed protocol, remote headers, and segment allocation
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => cleanupPendingAndClose(false)}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded bg-surface border border-outline font-label text-label-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
          >
            <ArrowLeft size={13} aria-hidden="true" />
            <span>Back to Queue</span>
          </button>
        </div>

        {/* Protocol Tabs (hidden when reviewing an expanded batch) */}
        {!createdBatch && (
          <div className="px-5 pt-2 border-b border-outline bg-surface flex items-center gap-1 shrink-0 overflow-x-auto">
            {PROTOCOL_TABS.map((tab) => {
              const Icon = tab.icon;
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-2 px-3 py-2 border-b-2 font-label text-label-md transition-colors duration-state-change ease-state-change ${
                    selected
                      ? "border-b-primary text-on-surface bg-primary-tint/50"
                      : "border-b-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
                  }`}
                >
                  <Icon
                    size={14}
                    className={selected ? "text-on-primary-badge" : undefined}
                    aria-hidden="true"
                  />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Active Body */}
        {createdBatch ? (
          <BatchPanel
            batch={createdBatch}
            onDone={() => cleanupPendingAndClose(true)}
          />
        ) : activeTab === "direct" ? (
          <DirectTab
            initialUrl={tabUrl}
            initialCapture={adoptedCapture}
            onCaptureIdChange={(id, manualUrl) => {
              ownedCaptureIdRef.current = id;
              if (manualUrl !== undefined) {
                manualProbeUrlRef.current = manualUrl;
              }
            }}
            onSwitchTab={(tab, nextUrl) => handleSwitchTab(tab, nextUrl)}
            onDone={() => cleanupPendingAndClose(true)}
          />
        ) : activeTab === "video" ? (
          <VideoTab
            initialUrl={tabUrl}
            initialVideoCapture={adoptedVideo}
            onVideoCaptureIdChange={(id) => {
              ownedVideoIdRef.current = id;
            }}
            onDone={() => cleanupPendingAndClose(true)}
          />
        ) : activeTab === "torrent" ? (
          <TorrentTab
            initialSource={tabUrl}
            onDone={() => cleanupPendingAndClose(true)}
          />
        ) : activeTab === "ollama" ? (
          <OllamaTab
            initialInput={tabUrl}
            onDone={() => cleanupPendingAndClose(true)}
          />
        ) : activeTab === "batch" ? (
          <BatchGrabberTab
            onBatchReady={(batch) => setCreatedBatch(batch)}
            onDone={() => cleanupPendingAndClose(true)}
          />
        ) : (
          <HuggingFaceTab
            initialInput={tabUrl}
            onDone={() => cleanupPendingAndClose(true)}
          />
        )}
      </div>
    </div>
  );
}
