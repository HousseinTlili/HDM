import { useState } from "react";
import {
  FolderOpen,
  Link2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import {
  canPauseItem,
  canResumeItem,
  copyItemUrl,
  redownloadItem,
  revealItemFolder,
  toggleItemTransfer,
} from "../../lib/actions";
import {
  computeAverageEtaSecs,
  computeProgressPct,
  formatBytes,
  formatEta,
  formatSpeed,
  joinPath,
} from "../../lib/format";
import { ipc } from "../../lib/ipc";
import type { DownloadItem, ItemDetails, Progress } from "../../lib/types";
import { useDownloadsStore } from "../../store/downloadsStore";
import { useUiStore } from "../../store/uiStore";
import { SpeedGraph } from "./SpeedGraph";

interface TorrentInspectorProps {
  item: DownloadItem;
  details: ItemDetails | null;
  progress?: Progress;
}

export function TorrentInspector({
  item,
  details,
  progress,
}: TorrentInspectorProps) {
  const pushToast = useUiStore((s) => s.pushToast);
  const avgSpeed = useDownloadsStore((s) => s.avgSpeedById[item.id]);

  const downloaded = progress?.downloaded ?? item.downloaded;
  const totalSize = progress?.size ?? item.size;
  const pct = computeProgressPct(item, progress);
  const peers = progress?.connections ?? 0;
  const avgEtaSecs = computeAverageEtaSecs(downloaded, totalSize, avgSpeed);
  const infoHash =
    typeof item.request?.infoHash === "string" ? item.request.infoHash : null;
  const sequential = Boolean(item.request?.sequential);
  const savedDlBps =
    typeof item.request?.maxDlBps === "number" ? item.request.maxDlBps : 0;
  const savedUlBps =
    typeof item.request?.maxUlBps === "number" ? item.request.maxUlBps : 0;
  const savedTrackers = Array.isArray(item.request?.extraTrackers)
    ? (item.request?.extraTrackers as string[])
    : [];

  const [rechecking, setRechecking] = useState(false);
  const [dlDraft, setDlDraft] = useState(() =>
    savedDlBps > 0 ? Number((savedDlBps / (1024 * 1024)).toFixed(2)).toString() : "0"
  );
  const [ulDraft, setUlDraft] = useState(() =>
    savedUlBps > 0 ? Number((savedUlBps / (1024 * 1024)).toFixed(2)).toString() : "0"
  );
  const [trackersDraft, setTrackersDraft] = useState(() => savedTrackers.join("\n"));

  const handleRecheck = async () => {
    if (rechecking) return;
    setRechecking(true);
    try {
      await ipc.recheckTorrent(item.id);
      pushToast("info", "Force rechecking existing pieces on disk…");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setRechecking(false);
    }
  };

  const handleToggleSequential = async () => {
    try {
      await ipc.setTorrentOptions({ id: item.id, sequential: !sequential });
      pushToast(
        "info",
        !sequential
          ? "Sequential mode ON (head & tail pieces prioritized)"
          : "Sequential mode OFF (rarest-first)"
      );
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleCommitLimits = async () => {
    const dlMb = Number(dlDraft);
    const ulMb = Number(ulDraft);
    const maxDlBps =
      Number.isFinite(dlMb) && dlMb > 0 ? Math.round(dlMb * 1024 * 1024) : 0;
    const maxUlBps =
      Number.isFinite(ulMb) && ulMb > 0 ? Math.round(ulMb * 1024 * 1024) : 0;
    try {
      await ipc.setTorrentOptions({ id: item.id, maxDlBps, maxUlBps });
      pushToast("success", "Updated per-torrent speed limits");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleApplyTrackers = async () => {
    const list = trackersDraft
      .split(/[\r\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await ipc.setTorrentOptions({ id: item.id, extraTrackers: list });
      pushToast(
        "success",
        list.length > 0
          ? `Added ${list.length} custom tracker(s) & re-announced`
          : "Cleared custom trackers"
      );
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleCopyHash = async () => {
    if (!infoHash) return;
    try {
      await ipc.clipboardWrite(infoHash);
      pushToast("success", "Copied info-hash");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex-1 flex flex-col justify-between min-h-0">
      <div className="p-4 flex flex-col gap-4 overflow-y-auto min-h-0">
        <SpeedGraph
          history={details?.speedHistory ?? []}
          liveSpeed={progress?.speed ?? 0}
        />

        <div className="rounded-md bg-surface border border-outline p-3 grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="font-label text-label-sm text-on-surface-variant">
              DL Speed
            </span>
            <span className="font-mono text-mono-md tabular text-on-surface">
              {formatSpeed(progress?.speed ?? 0)}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-label text-label-sm text-on-surface-variant">
              Peers
            </span>
            <span className="font-mono text-mono-md tabular text-on-surface">
              {peers}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-label text-label-sm text-on-surface-variant">
              Progress
            </span>
            <span className="font-mono text-mono-md tabular text-on-surface">
              {pct.toFixed(1)}%
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-label text-label-sm text-on-surface-variant">
              Size
            </span>
            <span className="font-mono text-mono-md tabular text-on-surface">
              {formatBytes(totalSize ?? downloaded)}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-label text-label-sm text-on-surface-variant">
              Avg Speed
            </span>
            <span className="font-mono text-mono-md tabular text-on-surface">
              {formatSpeed(avgSpeed ?? 0)}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-label text-label-sm text-on-surface-variant">
              ETA (avg)
            </span>
            <span className="font-mono text-mono-md tabular text-on-surface">
              {formatEta(avgEtaSecs)}
            </span>
          </div>
        </div>

        <div className="rounded-md bg-surface border border-outline p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
              BitTorrent Engine
            </span>
            <span className="font-mono text-mono-sm text-status-connected">
              MSE/PE · TCP · DHT / PEX / LPD
            </span>
          </div>
          {infoHash && (
            <button
              type="button"
              onClick={() => void handleCopyHash()}
              title="Click to copy info-hash"
              className="text-left font-mono text-mono-sm text-on-surface bg-surface-container border border-outline rounded p-2 break-all hover:border-primary/40 transition-colors duration-state-change ease-state-change"
            >
              {infoHash}
            </button>
          )}
        </div>

        {item.status === "failed" && item.error && (
          <div className="rounded-md bg-primary-tint border border-primary/40 p-2.5 flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-primary-badge">
              Swarm Error
            </span>
            <span className="font-mono text-mono-sm text-on-surface break-words">
              {item.error}
            </span>
          </div>
        )}

        <div className="rounded-md bg-surface border border-outline p-3 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
              Swarm Controls
            </span>
            <button
              type="button"
              onClick={() => void handleToggleSequential()}
              className={`h-6 px-2 rounded-sm border font-mono text-mono-sm transition-colors duration-state-change ${
                sequential
                  ? "bg-primary-tint border-primary/40 text-on-primary-badge"
                  : "bg-surface-container-high border-outline text-on-surface-variant hover:text-on-surface"
              }`}
              title="Download head & tail pieces first so you can preview media early"
            >
              {sequential ? "Sequential: ON" : "Sequential: OFF"}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">
                DL Cap (MB/s, 0=max)
              </span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={dlDraft}
                onChange={(e) => setDlDraft(e.target.value)}
                onBlur={() => void handleCommitLimits()}
                className="h-7 px-2 rounded bg-surface-container border border-outline font-mono text-mono-sm text-on-surface"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">
                UL Cap (MB/s, 0=max)
              </span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={ulDraft}
                onChange={(e) => setUlDraft(e.target.value)}
                onBlur={() => void handleCommitLimits()}
                className="h-7 px-2 rounded bg-surface-container border border-outline font-mono text-mono-sm text-on-surface"
              />
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="font-label text-label-sm text-on-surface-variant">
                Extra Trackers
              </span>
              <button
                type="button"
                onClick={() => void handleApplyTrackers()}
                className="h-6 px-2 rounded-sm bg-surface-container-high border border-outline font-label text-label-sm text-on-surface hover:border-primary/40"
              >
                Re-announce
              </button>
            </div>
            <textarea
              rows={2}
              value={trackersDraft}
              onChange={(e) => setTrackersDraft(e.target.value)}
              placeholder="udp://tracker.example:1337/announce"
              className="w-full p-2 rounded bg-surface-container border border-outline font-mono text-mono-sm text-on-surface placeholder:text-on-surface-variant resize-none focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
            Save Path
          </span>
          <div className="font-mono text-mono-sm text-on-surface-variant bg-surface border border-outline rounded p-2 break-all select-all">
            {joinPath(item.saveDir, item.fileName)}
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-outline flex flex-col gap-2 shrink-0">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void revealItemFolder(item)}
            className="inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded bg-surface-container-high border border-outline text-on-surface font-label text-label-md hover:border-primary/40 transition-colors duration-state-change ease-state-change"
          >
            <FolderOpen size={14} className="text-on-surface-variant" aria-hidden="true" />
            <span>Open Folder</span>
          </button>
          <button
            type="button"
            onClick={() => void copyItemUrl(item)}
            className="inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded bg-surface-container-high border border-outline text-on-surface font-label text-label-md hover:border-primary/40 transition-colors duration-state-change ease-state-change"
          >
            <Link2 size={14} className="text-on-surface-variant" aria-hidden="true" />
            <span>Copy Magnet</span>
          </button>
        </div>

        <button
          type="button"
          disabled={rechecking}
          onClick={() => void handleRecheck()}
          className="inline-flex items-center justify-center gap-1.5 h-8 w-full px-3 rounded bg-surface-container-high border border-outline text-on-surface font-label text-label-md hover:border-primary/40 disabled:opacity-50 transition-colors duration-state-change ease-state-change"
        >
          <RefreshCw
            size={14}
            className={`text-on-surface-variant ${rechecking ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          <span>{rechecking ? "Rechecking Pieces…" : "Force Recheck"}</span>
        </button>

        {canPauseItem(item) ? (
          <button
            type="button"
            onClick={() => void toggleItemTransfer(item)}
            className="inline-flex items-center justify-center gap-1.5 h-8 w-full px-3 rounded bg-surface-container-high border border-outline text-on-surface font-label text-label-md hover:border-primary/40 transition-colors duration-state-change ease-state-change"
          >
            <Pause size={14} className="text-on-primary-badge" aria-hidden="true" />
            <span>Pause Swarm</span>
          </button>
        ) : canResumeItem(item) ? (
          <button
            type="button"
            onClick={() =>
              item.status === "failed"
                ? void redownloadItem(item)
                : void toggleItemTransfer(item)
            }
            className="inline-flex items-center justify-center gap-1.5 h-8 w-full px-3 rounded bg-primary text-on-primary font-label text-label-md hover:bg-primary/90 transition-colors duration-state-change ease-state-change"
          >
            {item.status === "failed" ? (
              <RotateCcw size={14} aria-hidden="true" />
            ) : (
              <Play size={14} aria-hidden="true" />
            )}
            <span>{item.status === "failed" ? "Retry Swarm" : "Resume Swarm"}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
