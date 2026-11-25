import { X } from "lucide-react";
import { useItemDetails } from "../../hooks/useItemDetails";
import { useDownloadsStore } from "../../store/downloadsStore";
import { useUiStore } from "../../store/uiStore";
import { ActiveInspector } from "./ActiveInspector";
import { CompletedInspector } from "./CompletedInspector";
import { TorrentInspector } from "./TorrentInspector";

export function InspectorDrawer() {
  const activeView = useUiStore((s) => s.activeView);
  const inspectorOpen = useUiStore((s) => s.inspectorOpen);
  const selectedId = useUiStore((s) => s.selectedId);
  const toggleInspector = useUiStore((s) => s.toggleInspector);

  const item = useDownloadsStore((s) =>
    selectedId ? s.itemsById[selectedId] ?? null : null
  );
  const liveProgress = useDownloadsStore((s) =>
    selectedId ? s.progressById[selectedId] : undefined
  );

  const enabled = inspectorOpen && activeView === "downloads" && Boolean(item);
  const details = useItemDetails(selectedId, 500, enabled);

  if (activeView !== "downloads") return null;

  const eyebrow = !item
    ? "Transfer Inspector"
    : item.status === "completed"
    ? "Artifact Verification"
    : item.kind === "torrent"
    ? "Swarm Inspector"
    : "Transfer Inspector";

  const progress = liveProgress ?? details?.progress ?? undefined;

  return (
    <aside
      aria-hidden={!inspectorOpen}
      inert={!inspectorOpen ? true : undefined}
      className={`${
        inspectorOpen ? "w-[320px]" : "w-0"
      } shrink-0 overflow-hidden bg-surface-container flex flex-col min-h-0 transition-[width] duration-panel-slide ease-panel-slide`}
    >
      <div
        className={`w-[320px] min-w-[320px] h-full flex flex-col min-h-0 transition-[transform,opacity] duration-panel-slide ease-panel-slide ${
          inspectorOpen
            ? "translate-x-0 opacity-100"
            : "translate-x-4 opacity-0 pointer-events-none"
        }`}
      >
        {/* Header */}
        <div className="p-4 pb-3 border-b border-outline flex items-start justify-between gap-2 shrink-0">
          <div className="min-w-0 flex flex-col gap-1">
            <span className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
              {eyebrow}
            </span>
            {item && (
              <h2 className="font-title text-title-md text-on-surface break-all line-clamp-2">
                {item.fileName || item.media?.title || item.url}
              </h2>
            )}
          </div>
          <button
            type="button"
            onClick={toggleInspector}
            aria-label="Close inspector"
            title="Close inspector"
            className="inline-flex items-center justify-center w-6 h-6 rounded-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high shrink-0 transition-colors duration-state-change ease-state-change"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        {!item ? (
          <div className="p-4">
            <p className="font-body text-body-sm text-on-surface-variant">
              Select a download row to inspect live speed telemetry, the 32-segment chunk map, or SHA-256 verification.
            </p>
          </div>
        ) : item.status === "completed" ? (
          <CompletedInspector key={item.id} item={item} />
        ) : item.kind === "torrent" ? (
          <TorrentInspector
            key={item.id}
            item={item}
            details={details}
            progress={progress}
          />
        ) : (
          <ActiveInspector
            key={item.id}
            item={item}
            details={details}
            progress={progress}
          />
        )}
      </div>
    </aside>
  );
}
