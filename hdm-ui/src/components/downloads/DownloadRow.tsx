import { memo } from "react";
import type { MouseEvent } from "react";
import {
  Cpu,
  Disc,
  FileArchive,
  FileDown,
  FolderOpen,
  MonitorPlay,
  MoreHorizontal,
  Pause,
  Play,
  RotateCcw,
  Share2,
} from "lucide-react";
import {
  canPauseItem,
  canResumeItem,
  openCompletedItem,
  redownloadItem,
  revealItemFolder,
  toggleItemTransfer,
  verifyItemSha256Action,
} from "../../lib/actions";
import {
  computeAverageEtaSecs,
  computeProgressPct,
  extractDomain,
  formatBytes,
  formatEta,
  formatRelativeTime,
  formatSpeed,
  isActiveStatus,
  isAiModelItem,
  isQueuedStatus,
  isVideoItem,
  protocolBadge,
  statusLabel,
} from "../../lib/format";
import type { DownloadItem } from "../../lib/types";
import { useDownloadsStore } from "../../store/downloadsStore";
import { useUiStore } from "../../store/uiStore";

export type RowViewMode = "default" | "completed" | "torrent";

interface DownloadRowProps {
  item: DownloadItem;
  mode: RowViewMode;
  selected: boolean;
}

function ItemTypeIcon({ item }: { item: DownloadItem }) {
  const lower = item.fileName.toLowerCase();
  if (isAiModelItem(item)) return <Cpu size={15} aria-hidden="true" />;
  if (isVideoItem(item)) return <MonitorPlay size={15} aria-hidden="true" />;
  if (item.kind === "torrent") return <Share2 size={15} aria-hidden="true" />;
  if (lower.endsWith(".iso") || lower.endsWith(".img")) {
    return <Disc size={15} aria-hidden="true" />;
  }
  if (
    lower.endsWith(".zip") ||
    lower.endsWith(".tar") ||
    lower.endsWith(".7z") ||
    lower.endsWith(".zst") ||
    lower.endsWith(".gz") ||
    lower.endsWith(".xz") ||
    lower.endsWith(".rar")
  ) {
    return <FileArchive size={15} aria-hidden="true" />;
  }
  return <FileDown size={15} aria-hidden="true" />;
}

function progressBarFillClass(status: DownloadItem["status"]): string {
  if (isActiveStatus(status)) return "bg-primary";
  if (status === "completed") return "bg-status-connected";
  if (status === "failed") return "bg-status-warning";
  return "bg-on-surface-variant";
}

function statusTextClass(status: DownloadItem["status"]): string {
  if (isActiveStatus(status)) return "text-on-primary-badge";
  if (status === "completed") return "text-status-connected";
  if (status === "paused" || status === "retrying") return "text-status-warning";
  if (status === "failed") return "text-primary";
  return "text-on-surface-variant";
}

function QuickHoverActions({
  item,
  selected,
}: {
  item: DownloadItem;
  selected: boolean;
}) {
  const openContextMenu = useUiStore((s) => s.openContextMenu);

  const stopAndRun = (e: MouseEvent, fn: () => void) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div
      className={`absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 px-1 py-0.5 rounded border border-outline opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-state-change ease-state-change ${
        selected ? "bg-primary-tint" : "bg-surface-container-high"
      }`}
    >
      {canPauseItem(item) && (
        <button
          type="button"
          onClick={(e) => stopAndRun(e, () => void toggleItemTransfer(item))}
          aria-label="Pause download"
          title="Pause"
          className="inline-flex items-center justify-center w-6 h-6 rounded-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
        >
          <Pause size={13} aria-hidden="true" />
        </button>
      )}
      {canResumeItem(item) && (
        <button
          type="button"
          onClick={(e) =>
            stopAndRun(e, () =>
              item.status === "failed"
                ? void redownloadItem(item)
                : void toggleItemTransfer(item)
            )
          }
          aria-label={item.status === "failed" ? "Retry download" : "Resume download"}
          title={item.status === "failed" ? "Retry" : "Resume"}
          className="inline-flex items-center justify-center w-6 h-6 rounded-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
        >
          {item.status === "failed" ? (
            <RotateCcw size={13} aria-hidden="true" />
          ) : (
            <Play size={13} aria-hidden="true" />
          )}
        </button>
      )}
      <button
        type="button"
        onClick={(e) => stopAndRun(e, () => void revealItemFolder(item))}
        aria-label="Show in folder"
        title="Show in folder"
        className="inline-flex items-center justify-center w-6 h-6 rounded-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
      >
        <FolderOpen size={13} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          openContextMenu(item.id, rect.right - 190, rect.bottom + 4);
        }}
        aria-label="More actions"
        title="More actions"
        className="inline-flex items-center justify-center w-6 h-6 rounded-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
      >
        <MoreHorizontal size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

export const DownloadRow = memo(function DownloadRow({
  item,
  mode,
  selected,
}: DownloadRowProps) {
  const progress = useDownloadsStore((s) => s.progressById[item.id]);
  const avgSpeed = useDownloadsStore((s) => s.avgSpeedById[item.id]);
  const verification = useUiStore((s) => s.verifiedById[item.id]);
  const verifying = useUiStore((s) => !!s.verifyingIds[item.id]);
  const securityReport = useUiStore((s) => s.securityById[item.id]);
  const dismissedSecurity = useUiStore((s) => !!s.dismissedSecurityIds[item.id]);
  const setSelectedId = useUiStore((s) => s.setSelectedId);
  const setInspectorOpen = useUiStore((s) => s.setInspectorOpen);
  const openContextMenu = useUiStore((s) => s.openContextMenu);

  const downloaded = progress?.downloaded ?? item.downloaded;
  const totalSize = progress?.size ?? item.size;
  const pct = computeProgressPct(item, progress);
  const active = isActiveStatus(item.status);
  const queued = isQueuedStatus(item.status);
  const proto = protocolBadge(item);
  const displayName = item.fileName || item.media?.title || item.url;

  const rowClasses = `group relative h-[60px] px-4 grid grid-cols-12 gap-3 items-center border-b border-outline-subtle cursor-pointer select-none transition-colors duration-state-change ease-state-change ${
    selected
      ? "bg-primary-tint border-l-2 border-l-primary"
      : "hover:bg-surface-container-high border-l-2 border-l-transparent"
  }`;

  const iconBoxClasses = `w-7 h-7 rounded border flex items-center justify-center shrink-0 ${
    selected
      ? "bg-primary-badge border-primary/40 text-on-primary-badge"
      : "bg-surface-container-high border-outline text-on-surface-variant"
  }`;

  const handleSelect = () => setSelectedId(item.id);
  const handleDoubleClick = () => {
    setSelectedId(item.id);
    if (item.status === "completed") {
      void openCompletedItem(item);
    } else {
      setInspectorOpen(true);
    }
  };
  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    setSelectedId(item.id);
    openContextMenu(item.id, e.clientX, e.clientY);
  };

  if (mode === "completed") {
    return (
      <div
        role="option"
        aria-selected={selected}
        onClick={handleSelect}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        className={rowClasses}
      >
        <div className="col-span-5 flex items-center gap-3 min-w-0">
          <div className={iconBoxClasses}>
            <ItemTypeIcon item={item} />
          </div>
          <div className="min-w-0 flex flex-col gap-0.5">
            <span className="font-title text-title-sm text-on-surface truncate">
              {displayName}
            </span>
            <span className="font-mono text-mono-sm text-on-surface-variant truncate">
              {item.saveDir || "—"}
            </span>
          </div>
        </div>

        <div className="col-span-2 flex items-center gap-1">
          {securityReport &&
          securityReport.verdict !== "clean" &&
          !dismissedSecurity ? (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-sm border font-mono text-mono-sm ${
                securityReport.verdict === "harmful"
                  ? "bg-primary-badge border-primary/40 text-on-primary-badge"
                  : "bg-status-warning-tint border-status-warning/30 text-status-warning"
              }`}
              title="Malware Guard flagged this file — click row to review, keep, or delete"
            >
              {securityReport.verdict === "harmful" ? "THREAT" : "CAUTION"}
            </span>
          ) : verification?.matches === true || (item.checksum && verification?.matches !== false) ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-sm bg-status-connected-tint border border-status-connected/30 font-mono text-mono-sm text-status-connected">
              SHA-256 OK
            </span>
          ) : verification?.matches === false ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-sm bg-primary-badge border border-primary/40 font-mono text-mono-sm text-on-primary-badge">
              SHA-256 ERR
            </span>
          ) : verification ? (
            <span
              title={verification.actual}
              className="inline-flex items-center px-2 py-0.5 rounded-sm bg-surface-container-high border border-outline font-mono text-mono-sm text-on-surface"
            >
              SHA-256
            </span>
          ) : isVideoItem(item) ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-sm bg-surface-container-high border border-outline font-mono text-mono-sm text-on-surface-variant">
              Muxed OK
            </span>
          ) : item.kind === "torrent" ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-sm bg-surface-container-high border border-outline font-mono text-mono-sm text-on-surface-variant">
              Multi-file
            </span>
          ) : (
            <button
              type="button"
              disabled={verifying}
              onClick={(e) => {
                e.stopPropagation();
                void verifyItemSha256Action(item);
              }}
              className="inline-flex items-center px-2 py-0.5 rounded-sm bg-surface-container-high border border-outline font-mono text-mono-sm text-on-surface-variant hover:text-on-surface hover:border-primary/50 disabled:opacity-50 transition-colors duration-state-change ease-state-change"
            >
              {verifying ? "Hashing…" : "Verify"}
            </button>
          )}
        </div>

        <div className="col-span-2 text-right font-mono text-mono-md tabular text-on-surface">
          {formatBytes(totalSize ?? downloaded)}
        </div>

        <div className="col-span-2 text-right font-mono text-mono-sm text-on-surface-variant">
          {proto}
        </div>

        <div className="col-span-1 text-right font-mono text-mono-sm tabular text-on-surface-variant group-hover:opacity-0 transition-opacity duration-state-change">
          {formatRelativeTime(item.finishedAt ?? item.addedAt)}
        </div>

        <QuickHoverActions item={item} selected={selected} />
      </div>
    );
  }

  if (mode === "torrent") {
    const peerLabel =
      progress?.connections != null ? `${progress.connections} peers` : "—";
    const speedDisplay = active ? `↓ ${formatSpeed(progress?.speed)}` : "—";

    return (
      <div
        role="option"
        aria-selected={selected}
        onClick={handleSelect}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        className={rowClasses}
      >
        <div className="col-span-5 flex items-center gap-3 min-w-0">
          <div className={iconBoxClasses}>
            <ItemTypeIcon item={item} />
          </div>
          <div className="min-w-0 flex flex-col gap-0.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-title text-title-sm text-on-surface truncate">
                {displayName}
              </span>
              <span className="font-mono text-mono-sm px-1.5 py-0.5 rounded-sm bg-surface-container-high border border-outline text-on-surface-variant shrink-0">
                DHT
              </span>
            </div>
            <span className="font-mono text-mono-sm tabular text-on-surface-variant truncate">
              {formatBytes(downloaded)} / {formatBytes(totalSize)}
            </span>
          </div>
        </div>

        <div className="col-span-2 text-right font-mono text-mono-sm tabular text-on-surface-variant">
          {peerLabel}
        </div>

        <div className="col-span-2 flex flex-col items-end gap-1.5">
          <span className="font-mono text-mono-sm tabular text-on-surface">
            {pct.toFixed(1)}%
          </span>
          <div className="w-full h-1.5 rounded-sm bg-surface-container-high overflow-hidden">
            <div
              className={`h-full rounded-sm ${progressBarFillClass(item.status)}`}
              style={{ width: `${pct.toFixed(1)}%` }}
            />
          </div>
        </div>

        <div className="col-span-3 text-right flex flex-col items-end gap-0.5 group-hover:opacity-0 transition-opacity duration-state-change">
          <span
            className={`font-mono text-mono-md tabular ${
              active ? "text-on-surface" : "text-on-surface-variant"
            }`}
          >
            {speedDisplay}
          </span>
          <span className={`font-label text-label-sm ${statusTextClass(item.status)}`}>
            {statusLabel(item.status)}
          </span>
        </div>

        <QuickHoverActions item={item} selected={selected} />
      </div>
    );
  }

  // Default layout: Active, All, Queued, Video, AI Models
  const domain = extractDomain(item.url);
  const metaParts = [`${formatBytes(downloaded)} / ${formatBytes(totalSize)}`];
  if (item.media?.quality) metaParts.push(item.media.quality);
  else if (domain) metaParts.push(domain);
  else if (item.status === "failed" && item.error) metaParts.push(item.error);

  const showSegmentedBar =
    active &&
    item.connections > 1 &&
    (item.kind === "http" || item.kind === "ftp");
  const filledBlocks =
    pct <= 0 ? 0 : Math.min(12, Math.max(1, Math.round((pct / 100) * 12)));

  const progressSublabel = queued
    ? item.queueId
      ? `Queue: ${item.queueId}`
      : "Queued"
    : proto;

  const speedText = active
    ? formatSpeed(progress?.speed)
    : item.status === "paused"
    ? "0.0 MB/s"
    : "—";

  const avgEtaSecs = active
    ? computeAverageEtaSecs(downloaded, totalSize, avgSpeed)
    : null;
  const etaText = active ? formatEta(avgEtaSecs) : "--:--";

  return (
    <div
      role="option"
      aria-selected={selected}
      onClick={handleSelect}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      className={rowClasses}
    >
      {/* File / Source */}
      <div className="col-span-5 flex items-center gap-3 min-w-0">
        <div className={iconBoxClasses}>
          <ItemTypeIcon item={item} />
        </div>
        <div className="min-w-0 flex flex-col gap-0.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-title text-title-sm text-on-surface truncate">
              {displayName}
            </span>

            {verification?.matches === false ? (
              <span className="font-mono text-mono-sm px-1.5 py-0.5 rounded-sm bg-primary-badge border border-primary/40 text-on-primary-badge shrink-0">
                SHA-256 ERR
              </span>
            ) : item.checksum || verification?.matches === true ? (
              <span className="font-mono text-mono-sm px-1.5 py-0.5 rounded-sm bg-status-connected-tint border border-status-connected/30 text-status-connected shrink-0">
                SHA-256
              </span>
            ) : active && item.connections > 1 && (item.kind === "http" || item.kind === "ftp") ? (
              <span className="font-mono text-mono-sm px-1.5 py-0.5 rounded-sm bg-surface-container-high border border-outline text-on-surface-variant shrink-0">
                {progress?.connections || item.connections}-SEG
              </span>
            ) : isVideoItem(item) ? (
              <span className="font-mono text-mono-sm px-1.5 py-0.5 rounded-sm bg-surface-container-high border border-outline text-on-surface-variant shrink-0">
                yt-dlp
              </span>
            ) : item.kind === "torrent" ? (
              <span className="font-mono text-mono-sm px-1.5 py-0.5 rounded-sm bg-surface-container-high border border-outline text-on-surface-variant shrink-0">
                DHT
              </span>
            ) : null}
          </div>

          <span
            className={`font-mono text-mono-sm tabular truncate ${
              item.status === "failed" && item.error
                ? "text-on-primary-badge"
                : "text-on-surface-variant"
            }`}
            title={item.error ?? item.url}
          >
            {item.status === "failed" && item.error
              ? `${formatBytes(downloaded)} / ${formatBytes(totalSize)} • ${item.error}`
              : metaParts.join(" • ")}
          </span>
        </div>
      </div>

      {/* Progress */}
      <div className="col-span-3 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span
            className={`font-mono text-mono-sm tabular ${
              active || item.status === "completed"
                ? "text-on-surface"
                : "text-on-surface-variant"
            }`}
          >
            {pct.toFixed(1)}%
          </span>
          <span className="font-mono text-mono-sm tabular text-on-surface-variant">
            {progressSublabel}
          </span>
        </div>

        {showSegmentedBar ? (
          <div
            className="grid grid-cols-12 gap-1 h-1.5"
            aria-label={`${pct.toFixed(1)}% across ${item.connections} connections`}
          >
            {Array.from({ length: 12 }, (_, idx) => (
              <span
                key={idx}
                className={
                  idx < filledBlocks
                    ? "bg-primary rounded-none"
                    : "bg-surface-container-high rounded-none"
                }
              />
            ))}
          </div>
        ) : (
          <div className="w-full h-1.5 rounded-sm bg-surface-container-high overflow-hidden">
            <div
              className={`h-full rounded-sm ${progressBarFillClass(item.status)}`}
              style={{ width: `${pct.toFixed(1)}%` }}
            />
          </div>
        )}
      </div>

      {/* Speed */}
      <div className="col-span-2 text-right">
        <span
          className={`font-mono text-mono-md tabular ${
            active ? "text-on-surface" : "text-on-surface-variant"
          }`}
        >
          {speedText}
        </span>
      </div>

      {/* ETA / State */}
      <div className="col-span-2 text-right flex flex-col items-end gap-0.5 group-hover:opacity-0 transition-opacity duration-state-change">
        <span
          className={`font-mono text-mono-md tabular ${
            active ? "text-on-surface" : "text-on-surface-variant"
          }`}
        >
          {etaText}
        </span>
        <span className={`font-label text-label-sm ${statusTextClass(item.status)}`}>
          {statusLabel(item.status)}
        </span>
      </div>

      <QuickHoverActions item={item} selected={selected} />
    </div>
  );
});
