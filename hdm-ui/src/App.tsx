import { useEffect, useMemo } from "react";
import { requestDeleteItems } from "./lib/actions";
import { filterAndSortItems, looksLikeDownloadLink } from "./lib/format";
import { ipc, onCoreEvent, onHdmIntent } from "./lib/ipc";
import {
  getAutoScanEnabled,
  scanCompletedItemAction,
  shouldAutoScanFile,
} from "./lib/security";
import { showWindow } from "./lib/window";
import { useDownloadsStore } from "./store/downloadsStore";
import { useUiStore } from "./store/uiStore";
import { ToastHost } from "./components/common/ToastHost";
import { ActionToolbar } from "./components/downloads/ActionToolbar";
import { DeleteConfirmModal } from "./components/downloads/DeleteConfirmModal";
import { DownloadList } from "./components/downloads/DownloadList";
import { RowContextMenu } from "./components/downloads/RowContextMenu";
import { InspectorDrawer } from "./components/inspector/InspectorDrawer";
import { AddDownloadModal } from "./components/modals/AddDownloadModal";
import { ModelHubView } from "./components/models/ModelHubView";
import { SchedulerView } from "./components/scheduler/SchedulerView";
import { SettingsView } from "./components/settings/SettingsView";
import { Sidebar } from "./components/shell/Sidebar";
import { TitleBar } from "./components/shell/TitleBar";

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function App() {
  const itemsById = useDownloadsStore((s) => s.itemsById);
  const itemOrder = useDownloadsStore((s) => s.itemOrder);
  const progressById = useDownloadsStore((s) => s.progressById);
  const init = useDownloadsStore((s) => s.init);
  const applyCoreEvent = useDownloadsStore((s) => s.applyCoreEvent);

  const activeView = useUiStore((s) => s.activeView);
  const activeFilter = useUiStore((s) => s.activeFilter);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const sortBy = useUiStore((s) => s.sortBy);
  const selectedId = useUiStore((s) => s.selectedId);

  const setActiveView = useUiStore((s) => s.setActiveView);
  const setPendingIntent = useUiStore((s) => s.setPendingIntent);
  const setQuickPasteUrl = useUiStore((s) => s.setQuickPasteUrl);
  const pushToast = useUiStore((s) => s.pushToast);
  const postActionPending = useUiStore((s) => s.postActionPending);
  const setPostActionPending = useUiStore((s) => s.setPostActionPending);

  useEffect(() => {
    let alive = true;
    let unlistenCore: (() => void) | undefined;
    let unlistenIntent: (() => void) | undefined;
    const seenSeq = new Set<number>();

    const handleIntent = (intent: Parameters<typeof setPendingIntent>[0]) => {
      if (!intent) return;
      if (intent.seq != null) {
        if (seenSeq.has(intent.seq)) return;
        seenSeq.add(intent.seq);
      }
      setPendingIntent(intent);
      if (intent.kind === "new" && intent.url) {
        setQuickPasteUrl(intent.url);
      }
    };

    void (async () => {
      try {
        await init();
        unlistenCore = await onCoreEvent((ev) => {
          if (!alive) return;
          applyCoreEvent(ev);
          if (ev.type === "postActionPending") {
            setPostActionPending(ev.payload);
          }
          if (
            ev.type === "completed" &&
            ev.payload.kind !== "torrent" &&
            getAutoScanEnabled() &&
            shouldAutoScanFile(ev.payload.fileName)
          ) {
            void scanCompletedItemAction(ev.payload, { silentIfClean: true });
          }
        });
        unlistenIntent = await onHdmIntent((intent) => {
          if (alive) handleIntent(intent);
        });
        const queued = await ipc.drainUiIntents();
        if (alive && queued.length > 0) {
          for (const item of queued) {
            handleIntent(item);
          }
        }
      } catch (err) {
        console.error("HDM bootstrap failed:", err);
        if (alive) {
          pushToast(
            "error",
            err instanceof Error ? err.message : "Failed to initialize HDM engine"
          );
        }
      } finally {
        const shouldShow = await ipc.mainWindowStartsVisible().catch(() => true);
        if (alive && shouldShow) {
          requestAnimationFrame(() => {
            void showWindow();
          });
        }
      }
    })();

    return () => {
      alive = false;
      unlistenCore?.();
      unlistenIntent?.();
    };
  }, [init, applyCoreEvent, setPendingIntent, setQuickPasteUrl, pushToast]);

  const allItems = useMemo(
    () => itemOrder.map((id) => itemsById[id]).filter(Boolean),
    [itemOrder, itemsById]
  );

  const filteredItems = useMemo(
    () =>
      filterAndSortItems(
        allItems,
        progressById,
        activeFilter,
        searchQuery,
        sortBy
      ),
    [allItems, progressById, activeFilter, searchQuery, sortBy]
  );

  const completedBytes = useMemo(
    () =>
      allItems.reduce((sum, item) => {
        if (item.trashed || item.status !== "completed") return sum;
        return sum + (item.size ?? item.downloaded);
      }, 0),
    [allItems]
  );

  const torrentSpeed = useMemo(
    () =>
      allItems.reduce((sum, item) => {
        if (item.trashed || item.kind !== "torrent") return sum;
        return sum + (progressById[item.id]?.speed ?? 0);
      }, 0),
    [allItems, progressById]
  );

  const selectedItem = selectedId ? itemsById[selectedId] ?? null : null;

  // Global keyboard shortcuts: Ctrl+, settings, Ctrl+F search, Escape dismiss, Delete selected, Ctrl+V paste link
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key === ",") {
        e.preventDefault();
        const cur = useUiStore.getState().activeView;
        setActiveView(cur === "settings" ? "downloads" : "settings");
        return;
      }

      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setActiveView("downloads");
        requestAnimationFrame(() => {
          const el = document.getElementById(
            "hdm-search-input"
          ) as HTMLInputElement | null;
          el?.focus();
          el?.select();
        });
        return;
      }

      if (e.key === "Escape") {
        const ui = useUiStore.getState();
        if (ui.contextMenu) {
          ui.closeContextMenu();
          return;
        }
        if (ui.deleteConfirm) {
          ui.closeDeleteConfirm();
          return;
        }
        return;
      }

      if (isEditableElement(e.target)) return;

      const ui = useUiStore.getState();
      if (
        e.key === "Delete" &&
        ui.activeView === "downloads" &&
        !ui.deleteConfirm &&
        !ui.pendingIntent &&
        selectedItem
      ) {
        e.preventDefault();
        void requestDeleteItems([selectedItem.id], false);
        return;
      }

      if (
        mod &&
        e.key.toLowerCase() === "v" &&
        !ui.deleteConfirm &&
        !ui.pendingIntent
      ) {
        e.preventDefault();
        void ipc
          .clipboardRead()
          .then((text) => {
            const trimmed = text.trim();
            if (looksLikeDownloadLink(trimmed)) {
              setQuickPasteUrl(trimmed);
              setPendingIntent({ kind: "new", url: trimmed });
            } else {
              pushToast("info", "No supported download URL found in clipboard");
            }
          })
          .catch(() => {});
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedItem, setActiveView, setPendingIntent, setQuickPasteUrl, pushToast]);

  return (
    <div className="h-screen w-screen flex flex-col bg-surface-container text-on-surface overflow-hidden">
      <TitleBar />

      {postActionPending && (
        <div className="px-4 py-2 bg-primary-tint border-b border-primary/40 flex items-center justify-between gap-3 shrink-0">
          <span className="font-label text-label-md text-on-surface">
            Scheduled post-download action ({postActionPending.action.type}) will execute in{" "}
            <span className="font-mono tabular text-on-primary-badge">
              {postActionPending.seconds}s
            </span>
          </span>
          <button
            type="button"
            onClick={() => {
              void ipc.cancelPostAction().catch(() => {});
              setPostActionPending(null);
              pushToast("info", "Cancelled scheduled power action");
            }}
            className="h-7 px-3 rounded bg-primary text-on-primary font-label text-label-sm"
          >
            Cancel Action
          </button>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {activeView === "downloads" ? (
          <>
            <Sidebar />
            <main className="flex-1 min-w-0 bg-surface rounded-xl border border-outline/80 overflow-hidden mb-2 mr-2 flex flex-col min-h-0">
              <ActionToolbar
                visibleCount={filteredItems.length}
                completedBytes={completedBytes}
                torrentSpeed={torrentSpeed}
              />
              <DownloadList items={filteredItems} />
            </main>
            <InspectorDrawer />
          </>
        ) : activeView === "models" ? (
          <>
            <Sidebar />
            <ModelHubView />
          </>
        ) : activeView === "scheduler" ? (
          <>
            <Sidebar />
            <SchedulerView />
          </>
        ) : (
          <SettingsView />
        )}
      </div>

      <AddDownloadModal />
      <RowContextMenu />
      <DeleteConfirmModal />
      <ToastHost />
    </div>
  );
}
