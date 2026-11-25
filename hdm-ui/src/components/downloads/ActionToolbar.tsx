import { useState } from "react";
import { Eraser, Gauge, Pause, Play, Plus, Search, X } from "lucide-react";
import { formatBytes, formatSpeed } from "../../lib/format";
import { ipc } from "../../lib/ipc";
import type { SortKey } from "../../lib/types";
import { useDownloadsStore } from "../../store/downloadsStore";
import { useUiStore } from "../../store/uiStore";

interface ActionToolbarProps {
  visibleCount: number;
  completedBytes: number;
  torrentSpeed: number;
}

export function ActionToolbar({
  visibleCount,
  completedBytes,
  torrentSpeed,
}: ActionToolbarProps) {
  const speedLimiterEnabled = useDownloadsStore(
    (s) => s.settings?.downloads.speedLimiterEnabled ?? false
  );
  const speedLimit = useDownloadsStore(
    (s) => s.settings?.downloads.speedLimit ?? 5 * 1024 * 1024
  );

  const activeFilter = useUiStore((s) => s.activeFilter);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const sortBy = useUiStore((s) => s.sortBy);
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);
  const setSortBy = useUiStore((s) => s.setSortBy);
  const setPendingIntent = useUiStore((s) => s.setPendingIntent);
  const pushToast = useUiStore((s) => s.pushToast);

  const [clearing, setClearing] = useState(false);

  const handleToggleLimiter = async () => {
    try {
      const enabled = await ipc.toggleSpeedLimiter();
      pushToast(
        "info",
        enabled
          ? `Speed cap enabled (${formatSpeed(speedLimit)})`
          : "Speed cap disabled"
      );
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handlePauseAll = async () => {
    try {
      await ipc.pauseAll();
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleResumeAll = async () => {
    try {
      await ipc.resumeAll();
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleClearMissing = async () => {
    if (clearing) return;
    setClearing(true);
    try {
      const removed = await ipc.clearMissingCompleted();
      if (removed > 0) {
        pushToast("success", `Cleared ${removed} missing item${removed === 1 ? "" : "s"}`);
      } else {
        pushToast("info", "No missing files found");
      }
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setClearing(false);
    }
  };

  const searchPlaceholder =
    activeFilter === "completed"
      ? "Search history..."
      : activeFilter === "torrent"
      ? "Filter torrents..."
      : "Filter queue...";

  return (
    <div className="px-4 py-3 border-b border-outline flex items-center justify-between gap-3 bg-surface shrink-0">
      {/* Left Cluster */}
      {activeFilter === "completed" ? (
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="font-title text-title-lg text-on-surface truncate">
            Completed &amp; Verified
          </h1>
          <span className="font-mono text-mono-sm tabular px-2 py-0.5 rounded-sm bg-surface-container border border-outline text-on-surface-variant shrink-0">
            {visibleCount} {visibleCount === 1 ? "item" : "items"}
          </span>
          <span className="font-mono text-mono-sm tabular px-2 py-0.5 rounded-sm bg-surface-container border border-outline text-on-surface-variant shrink-0">
            {formatBytes(completedBytes)} saved
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() =>
              setPendingIntent(
                activeFilter === "torrent"
                  ? { kind: "torrent", source: "" }
                  : { kind: "new" }
              )
            }
            className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded bg-primary text-on-primary font-label text-label-md hover:bg-primary/90 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary transition-colors duration-state-change ease-state-change shrink-0"
          >
            <Plus size={15} aria-hidden="true" />
            <span>
              {activeFilter === "torrent" ? "Add Magnet / .torrent" : "New Download"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => void handlePauseAll()}
            aria-label="Pause all downloads"
            title="Pause all"
            className="inline-flex items-center justify-center w-8 h-8 rounded bg-surface-container border border-outline text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors duration-state-change ease-state-change shrink-0"
          >
            <Pause size={15} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => void handleResumeAll()}
            aria-label="Resume all downloads"
            title="Resume all"
            className="inline-flex items-center justify-center w-8 h-8 rounded bg-surface-container border border-outline text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors duration-state-change ease-state-change shrink-0"
          >
            <Play size={15} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => void handleToggleLimiter()}
            aria-pressed={speedLimiterEnabled}
            title={
              speedLimiterEnabled
                ? `Global speed cap active (${formatSpeed(speedLimit)}). Click to disable.`
                : `Enable global speed cap (${formatSpeed(speedLimit)})`
            }
            className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded border font-mono text-mono-sm tabular transition-colors duration-state-change ease-state-change shrink-0 ${
              speedLimiterEnabled
                ? "bg-status-warning-tint border-status-warning/40 text-status-warning"
                : "bg-surface-container border-outline text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
            }`}
          >
            <Gauge size={14} aria-hidden="true" />
            <span>
              {speedLimiterEnabled ? `Cap: ${formatSpeed(speedLimit)}` : "Speed Limit"}
            </span>
          </button>
        </div>
      )}

      {/* Right Cluster: Live Torrent DL + Search + Sort + Clear Missing */}
      <div className="flex items-center gap-2 shrink-0">
        {activeFilter === "torrent" && (
          <span className="font-mono text-mono-sm tabular px-2 py-1 rounded-sm bg-surface-container border border-outline text-on-surface-variant">
            DL: {formatSpeed(torrentSpeed)}
          </span>
        )}

        <label className="relative flex items-center w-56">
          <Search
            size={14}
            className="text-on-surface-variant absolute left-2.5 pointer-events-none"
            aria-hidden="true"
          />
          <input
            id="hdm-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="w-full h-8 pl-8 pr-7 rounded bg-surface-container border border-outline text-body-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary transition-colors duration-state-change ease-state-change"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear filter"
              className="absolute right-1.5 inline-flex items-center justify-center w-5 h-5 rounded-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
            >
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </label>

        <select
          aria-label="Sort downloads"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="h-8 pl-2.5 pr-6 rounded bg-surface-container border border-outline font-label text-label-md text-on-surface focus:outline-none focus:border-primary transition-colors duration-state-change ease-state-change"
        >
          <option value="speed">Sort: Speed (High)</option>
          <option value="progress">Sort: Progress</option>
          <option value="added">Sort: Date Added</option>
          <option value="size">Sort: File Size</option>
        </select>

        {activeFilter === "completed" && (
          <button
            type="button"
            disabled={clearing}
            onClick={() => void handleClearMissing()}
            title="Remove entries whose downloaded file no longer exists on disk"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-surface-container border border-outline font-label text-label-md text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high disabled:opacity-50 transition-colors duration-state-change ease-state-change"
          >
            <Eraser size={14} aria-hidden="true" />
            <span>{clearing ? "Clearing..." : "Clear Missing"}</span>
          </button>
        )}
      </div>
    </div>
  );
}
