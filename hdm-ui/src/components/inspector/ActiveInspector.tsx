import { useState } from "react";
import { Copy, FolderOpen, Pause, Play, RotateCcw } from "lucide-react";
import {
  canPauseItem,
  canResumeItem,
  copyItemPath,
  redownloadItem,
  revealItemFolder,
  toggleItemTransfer,
} from "../../lib/actions";
import {
  formatBytes,
  joinPath,
  protocolBadge,
  statusLabel,
} from "../../lib/format";
import { ipc } from "../../lib/ipc";
import type { DownloadItem, ItemDetails, Progress } from "../../lib/types";
import { useUiStore } from "../../store/uiStore";
import { ChunkMap32 } from "./ChunkMap32";
import { SpeedGraph } from "./SpeedGraph";

interface ActiveInspectorProps {
  item: DownloadItem;
  details: ItemDetails | null;
  progress?: Progress;
}

const THREAD_CHOICES = [1, 4, 8, 16, 32];

export function ActiveInspector({
  item,
  details,
  progress,
}: ActiveInspectorProps) {
  const pushToast = useUiStore((s) => s.pushToast);

  const initialMb =
    item.speedLimit > 0
      ? Number((item.speedLimit / (1024 * 1024)).toFixed(2)).toString()
      : "0";
  const [speedDraft, setSpeedDraft] = useState(initialMb);

  const downloaded = progress?.downloaded ?? item.downloaded;
  const totalSize = progress?.size ?? item.size;
  const proto = protocolBadge(item);
  const supportsThreads = item.kind === "http" || item.kind === "ftp";
  const isHttps = item.url.trim().toLowerCase().startsWith("https://");

  const threadOptions = THREAD_CHOICES.includes(item.connections)
    ? THREAD_CHOICES
    : [...THREAD_CHOICES, item.connections].sort((a, b) => a - b);

  const handleConnectionsChange = async (connections: number) => {
    try {
      await ipc.updateItem(item.id, { connections });
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    }
  };

  const commitSpeedLimit = async () => {
    const parsed = Number(speedDraft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setSpeedDraft(initialMb);
      return;
    }
    const bytesPerSec = parsed === 0 ? 0 : Math.round(parsed * 1024 * 1024);
    if (bytesPerSec === item.speedLimit) return;
    try {
      await ipc.updateItem(item.id, { speedLimit: bytesPerSec });
      pushToast(
        "info",
        bytesPerSec === 0
          ? "Item speed limit cleared"
          : `Item capped at ${parsed} MB/s`
      );
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

        <ChunkMap32
          segments={details?.segments ?? []}
          totalSize={totalSize}
          status={item.status}
          downloaded={downloaded}
        />

        {/* Protocol & Engine Controls */}
        <div className="rounded-md bg-surface border border-outline p-3 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
              Protocol
            </span>
            <span className="font-mono text-mono-sm text-on-surface-variant tabular">
              {formatBytes(downloaded)} / {formatBytes(totalSize)}
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-mono-sm px-2 py-0.5 rounded-sm bg-surface-container-high border border-outline text-on-surface">
              {proto}
              {supportsThreads ? ` • ${item.connections}T` : ""}
            </span>
            {isHttps && (
              <span className="font-mono text-mono-sm px-2 py-0.5 rounded-sm bg-surface-container-high border border-outline text-on-surface-variant">
                TLS
              </span>
            )}
            <span className="font-mono text-mono-sm px-2 py-0.5 rounded-sm bg-surface-container-high border border-outline text-on-surface-variant">
              {statusLabel(item.status)}
            </span>
          </div>

          {supportsThreads && (
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-outline-subtle">
              <label className="flex flex-col gap-1">
                <span className="font-label text-label-sm text-on-surface-variant">
                  Threads (1-32)
                </span>
                <select
                  aria-label="Connections for item"
                  value={item.connections}
                  onChange={(e) => void handleConnectionsChange(Number(e.target.value))}
                  className="h-7 px-2 rounded bg-surface-container border border-outline font-mono text-mono-sm text-on-surface focus:outline-none focus:border-primary"
                >
                  {threadOptions.map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? "Thread" : "Threads"}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-label text-label-sm text-on-surface-variant">
                  Cap (MB/s, 0=max)
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={speedDraft}
                  onChange={(e) => setSpeedDraft(e.target.value)}
                  onBlur={() => void commitSpeedLimit()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitSpeedLimit();
                  }}
                  aria-label="Item speed limit in MB/s"
                  className="h-7 px-2 rounded bg-surface-container border border-outline font-mono text-mono-sm tabular text-on-surface text-right focus:outline-none focus:border-primary"
                />
              </label>
            </div>
          )}
        </div>

        {item.status === "failed" && item.error && (
          <div className="rounded-md bg-primary-tint border border-primary/40 p-2.5 flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-primary-badge">
              Transfer Error
            </span>
            <span className="font-mono text-mono-sm text-on-surface break-words">
              {item.error}
            </span>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
              Source URL
            </span>
            <div className="font-mono text-mono-sm text-on-surface bg-surface border border-outline rounded p-2 break-all select-all max-h-20 overflow-y-auto">
              {item.url}
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
            onClick={() => void copyItemPath(item)}
            className="inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded bg-surface-container-high border border-outline text-on-surface font-label text-label-md hover:border-primary/40 transition-colors duration-state-change ease-state-change"
          >
            <Copy size={14} className="text-on-surface-variant" aria-hidden="true" />
            <span>Copy Path</span>
          </button>
        </div>

        {canPauseItem(item) ? (
          <button
            type="button"
            onClick={() => void toggleItemTransfer(item)}
            className="inline-flex items-center justify-center gap-1.5 h-8 w-full px-3 rounded bg-surface-container-high border border-outline text-on-surface font-label text-label-md hover:border-primary/40 transition-colors duration-state-change ease-state-change"
          >
            <Pause size={14} className="text-on-primary-badge" aria-hidden="true" />
            <span>Pause Transfer</span>
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
            <span>
              {item.status === "failed" ? "Retry Transfer" : "Resume Transfer"}
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
