import { useEffect, useRef } from "react";
import {
  CalendarClock,
  Copy,
  ExternalLink,
  FolderOpen,
  Link2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { ipc } from "../../lib/ipc";
import {
  canPauseItem,
  canResumeItem,
  copyItemPath,
  copyItemUrl,
  openCompletedItem,
  redownloadItem,
  requestDeleteItems,
  revealItemFolder,
  toggleItemTransfer,
  verifyItemSha256Action,
} from "../../lib/actions";
import { useDownloadsStore } from "../../store/downloadsStore";
import { useUiStore } from "../../store/uiStore";

export function RowContextMenu() {
  const contextMenu = useUiStore((s) => s.contextMenu);
  const closeContextMenu = useUiStore((s) => s.closeContextMenu);
  const item = useDownloadsStore((s) =>
    contextMenu ? s.itemsById[contextMenu.id] : undefined
  );
  const queues = useDownloadsStore((s) => s.queues);
  const pushToast = useUiStore((s) => s.pushToast);

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    };
    const handleDismiss = () => closeContextMenu();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeContextMenu();
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("blur", handleDismiss);
    window.addEventListener("scroll", handleDismiss, true);
    window.addEventListener("keydown", handleKey);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("blur", handleDismiss);
      window.removeEventListener("scroll", handleDismiss, true);
      window.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu, closeContextMenu]);

  if (!contextMenu || !item) return null;

  const left = Math.max(8, Math.min(contextMenu.x, window.innerWidth - 208));
  const top = Math.max(8, Math.min(contextMenu.y, window.innerHeight - 320));

  const pauseAvailable = canPauseItem(item);
  const resumeAvailable = canResumeItem(item);
  const retryAvailable = item.status === "failed" || item.status === "completed";
  const openAvailable = item.status === "completed";
  const verifyAvailable = item.status === "completed" && item.kind !== "torrent";

  const runAndClose = (action: () => void | Promise<void>) => {
    closeContextMenu();
    void action();
  };

  const itemClass =
    "w-full px-3 py-1.5 flex items-center gap-2 text-left font-label text-label-md text-on-surface hover:bg-surface-container-high disabled:opacity-40 disabled:pointer-events-none transition-colors duration-state-change ease-state-change";

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Download actions"
      style={{ left, top }}
      className="fixed z-50 w-48 py-1 rounded-md bg-surface-container border border-outline select-none"
    >
      {pauseAvailable && (
        <button
          type="button"
          role="menuitem"
          onClick={() => runAndClose(() => toggleItemTransfer(item))}
          className={itemClass}
        >
          <Pause size={14} className="text-on-surface-variant" aria-hidden="true" />
          <span>Pause</span>
        </button>
      )}
      {resumeAvailable && (
        <button
          type="button"
          role="menuitem"
          onClick={() => runAndClose(() => toggleItemTransfer(item))}
          className={itemClass}
        >
          <Play size={14} className="text-on-surface-variant" aria-hidden="true" />
          <span>Resume</span>
        </button>
      )}
      {retryAvailable && (
        <button
          type="button"
          role="menuitem"
          onClick={() => runAndClose(() => redownloadItem(item))}
          className={itemClass}
        >
          <RotateCcw size={14} className="text-on-surface-variant" aria-hidden="true" />
          <span>Retry / Redownload</span>
        </button>
      )}

      {item.kind === "torrent" && (
        <button
          type="button"
          role="menuitem"
          onClick={() =>
            runAndClose(async () => {
              try {
                await ipc.recheckTorrent(item.id);
                pushToast("info", `Force rechecking pieces for ${item.fileName}`);
              } catch (err) {
                pushToast("error", err instanceof Error ? err.message : String(err));
              }
            })
          }
          className={itemClass}
        >
          <RefreshCw size={14} className="text-on-surface-variant" aria-hidden="true" />
          <span>Force Recheck</span>
        </button>
      )}

      {(pauseAvailable || resumeAvailable || retryAvailable) && (
        <div className="my-1 border-t border-outline-subtle" aria-hidden="true" />
      )}

      <button
        type="button"
        role="menuitem"
        disabled={!openAvailable}
        onClick={() => runAndClose(() => openCompletedItem(item))}
        className={itemClass}
      >
        <ExternalLink size={14} className="text-on-surface-variant" aria-hidden="true" />
        <span>Open File</span>
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={() => runAndClose(() => revealItemFolder(item))}
        className={itemClass}
      >
        <FolderOpen size={14} className="text-on-surface-variant" aria-hidden="true" />
        <span>Show in Folder</span>
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={() => runAndClose(() => copyItemPath(item))}
        className={itemClass}
      >
        <Copy size={14} className="text-on-surface-variant" aria-hidden="true" />
        <span>Copy Full Path</span>
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={() => runAndClose(() => copyItemUrl(item))}
        className={itemClass}
      >
        <Link2 size={14} className="text-on-surface-variant" aria-hidden="true" />
        <span>Copy Source URL</span>
      </button>

      <button
        type="button"
        role="menuitem"
        disabled={!verifyAvailable}
        onClick={() => runAndClose(() => verifyItemSha256Action(item))}
        className={itemClass}
      >
        <ShieldCheck size={14} className="text-on-surface-variant" aria-hidden="true" />
        <span>Verify SHA-256</span>
      </button>

      {queues.length > 0 && (
        <>
          <div className="my-1 border-t border-outline-subtle" aria-hidden="true" />
          {queues.slice(0, 4).map((q) => (
            <button
              key={q.id}
              type="button"
              role="menuitem"
              onClick={() =>
                runAndClose(async () => {
                  try {
                    await ipc.assignToQueue([item.id], q.id);
                    pushToast("success", `Assigned to ${q.name}`);
                  } catch (err) {
                    pushToast("error", err instanceof Error ? err.message : String(err));
                  }
                })
              }
              className={itemClass}
            >
              <CalendarClock size={14} className="text-on-surface-variant" aria-hidden="true" />
              <span className="truncate">
                {item.queueId === q.id ? `✓ ${q.name}` : `Queue: ${q.name}`}
              </span>
            </button>
          ))}
        </>
      )}

      <div className="my-1 border-t border-outline-subtle" aria-hidden="true" />

      <button
        type="button"
        role="menuitem"
        onClick={() => runAndClose(() => requestDeleteItems([item.id], false))}
        className={itemClass}
      >
        <Trash2 size={14} className="text-on-surface-variant" aria-hidden="true" />
        <span>Delete from List</span>
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={() => runAndClose(() => requestDeleteItems([item.id], true))}
        className="w-full px-3 py-1.5 flex items-center gap-2 text-left font-label text-label-md text-on-primary-badge hover:bg-primary-tint transition-colors duration-state-change ease-state-change"
      >
        <Trash2 size={14} className="text-on-primary-badge" aria-hidden="true" />
        <span>Delete with File…</span>
      </button>
    </div>
  );
}
