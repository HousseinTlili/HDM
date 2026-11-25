import { useRef } from "react";
import type { KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Plus, SearchX } from "lucide-react";
import hdmLogo from "../../assets/hdm-logo.png";
import { openCompletedItem, toggleItemTransfer } from "../../lib/actions";
import type { DownloadItem } from "../../lib/types";
import { useUiStore } from "../../store/uiStore";
import { DownloadRow } from "./DownloadRow";
import type { RowViewMode } from "./DownloadRow";

interface DownloadListProps {
  items: DownloadItem[];
}

const EMPTY_COPY: Record<string, { title: string; body: string }> = {
  all: {
    title: "No downloads yet",
    body: "Paste a link in the bar above or start a new HTTP, video, torrent, or Hugging Face download.",
  },
  active: {
    title: "No active transfers",
    body: "Active downloads appear here while transferring chunks from servers or peers.",
  },
  completed: {
    title: "No completed files yet",
    body: "Finished downloads appear here with path tracking and on-demand SHA-256 verification.",
  },
  queued: {
    title: "Queue is empty",
    body: "Downloads scheduled or queued for later execution appear here.",
  },
  video: {
    title: "No video downloads",
    body: "Paste any YouTube or supported media link above to grab video/audio streams via yt-dlp.",
  },
  torrent: {
    title: "No torrents added",
    body: "Add a magnet URI or .torrent file to inspect files and download with librqbit.",
  },
  ai: {
    title: "No AI models queued",
    body: "Paste a Hugging Face repository or .gguf file link to fetch quantized weights with SHA-256 checks.",
  },
};

export function DownloadList({ items }: DownloadListProps) {
  const activeFilter = useUiStore((s) => s.activeFilter);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const selectedId = useUiStore((s) => s.selectedId);
  const setSelectedId = useUiStore((s) => s.setSelectedId);
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);
  const setPendingIntent = useUiStore((s) => s.setPendingIntent);

  const mode: RowViewMode =
    activeFilter === "completed"
      ? "completed"
      : activeFilter === "torrent"
      ? "torrent"
      : "default";

  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 60,
    overscan: 8,
    getItemKey: (index) => items[index].id,
  });

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (items.length === 0) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const currentIdx = selectedId ? items.findIndex((i) => i.id === selectedId) : -1;
      const nextIdx =
        e.key === "ArrowDown"
          ? currentIdx < items.length - 1
            ? currentIdx + 1
            : 0
          : currentIdx > 0
          ? currentIdx - 1
          : items.length - 1;
      setSelectedId(items[nextIdx].id);
      virtualizer.scrollToIndex(nextIdx, { align: "auto" });
      return;
    }

    if (e.key === "Enter" && selectedId) {
      const selected = items.find((i) => i.id === selectedId);
      if (!selected) return;
      e.preventDefault();
      if (selected.status === "completed") {
        void openCompletedItem(selected);
      } else {
        void toggleItemTransfer(selected);
      }
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Column Header Bar */}
      {mode === "completed" ? (
        <div className="px-4 py-2 border-b border-outline bg-surface-container grid grid-cols-12 gap-3 items-center text-on-surface-variant shrink-0 select-none">
          <div className="col-span-5 font-label text-label-sm uppercase tracking-wider">
            Artifact
          </div>
          <div className="col-span-2 font-label text-label-sm uppercase tracking-wider">
            Checksum
          </div>
          <div className="col-span-2 font-label text-label-sm uppercase tracking-wider text-right">
            Size
          </div>
          <div className="col-span-2 font-label text-label-sm uppercase tracking-wider text-right">
            Protocol
          </div>
          <div className="col-span-1 font-label text-label-sm uppercase tracking-wider text-right">
            Done
          </div>
        </div>
      ) : mode === "torrent" ? (
        <div className="px-4 py-2 border-b border-outline bg-surface-container grid grid-cols-12 gap-3 items-center text-on-surface-variant shrink-0 select-none">
          <div className="col-span-5 font-label text-label-sm uppercase tracking-wider">
            Swarm / Torrent
          </div>
          <div className="col-span-2 font-label text-label-sm uppercase tracking-wider text-right">
            Peers
          </div>
          <div className="col-span-2 font-label text-label-sm uppercase tracking-wider text-right">
            Progress
          </div>
          <div className="col-span-3 font-label text-label-sm uppercase tracking-wider text-right">
            Speed / State
          </div>
        </div>
      ) : (
        <div className="px-4 py-2 border-b border-outline bg-surface-container grid grid-cols-12 gap-3 items-center text-on-surface-variant shrink-0 select-none">
          <div className="col-span-5 font-label text-label-sm uppercase tracking-wider">
            File / Source
          </div>
          <div className="col-span-3 font-label text-label-sm uppercase tracking-wider">
            Progress
          </div>
          <div className="col-span-2 font-label text-label-sm uppercase tracking-wider text-right">
            Speed
          </div>
          <div className="col-span-2 font-label text-label-sm uppercase tracking-wider text-right">
            ETA / State
          </div>
        </div>
      )}

      {/* Virtualized Rows or Empty State */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        {/* Subtle faded dragon emblem watermark */}
        <div
          aria-hidden="true"
          className="pointer-events-none select-none absolute inset-0 flex items-center justify-center overflow-hidden z-0"
        >
          <img
            src={hdmLogo}
            alt=""
            draggable={false}
            className="w-[560px] max-w-[75%] max-h-[75%] object-contain opacity-[0.06] grayscale-[20%]"
          />
        </div>

        {items.length === 0 ? (
          <div className="relative z-10 flex-1 flex items-center justify-center p-8 overflow-y-auto">
            <div className="max-w-md w-full rounded-md bg-surface-container border border-outline p-6 flex flex-col items-start gap-3">
              {searchQuery.trim() ? (
                <>
                  <div className="flex items-center gap-2 text-on-surface">
                    <SearchX size={16} className="text-on-surface-variant" aria-hidden="true" />
                    <h2 className="font-title text-title-md">
                      No matching downloads
                    </h2>
                  </div>
                  <p className="font-body text-body-sm text-on-surface-variant">
                    Nothing in this view matched{" "}
                    <span className="font-mono text-on-surface">
                      &ldquo;{searchQuery.trim()}&rdquo;
                    </span>
                    .
                  </p>
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="h-8 px-3 rounded bg-surface-container-high border border-outline font-label text-label-md text-on-surface hover:border-primary/50 transition-colors duration-state-change ease-state-change"
                  >
                    Clear filter
                  </button>
                </>
              ) : (
                <>
                  <h2 className="font-title text-title-md text-on-surface">
                    {(EMPTY_COPY[activeFilter] ?? EMPTY_COPY.all).title}
                  </h2>
                  <p className="font-body text-body-sm text-on-surface-variant">
                    {(EMPTY_COPY[activeFilter] ?? EMPTY_COPY.all).body}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setPendingIntent(
                        activeFilter === "torrent"
                          ? { kind: "torrent", source: "" }
                          : { kind: "new" }
                      )
                    }
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-primary text-on-primary font-label text-label-md hover:bg-primary/90 transition-colors duration-state-change ease-state-change"
                  >
                    <Plus size={15} aria-hidden="true" />
                    <span>
                      {activeFilter === "torrent"
                        ? "Add Magnet / .torrent"
                        : "New Download"}
                    </span>
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div
            ref={scrollRef}
            role="listbox"
            aria-label="Download queue"
            tabIndex={0}
            onKeyDown={handleKeyDown}
            className="relative z-10 flex-1 min-h-0 overflow-y-auto focus:outline-none"
          >
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const item = items[virtualRow.index];
                return (
                  <div
                    key={item.id}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <DownloadRow
                      item={item}
                      mode={mode}
                      selected={selectedId === item.id}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
