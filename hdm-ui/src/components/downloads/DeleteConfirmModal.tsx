import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { ipc } from "../../lib/ipc";
import { useDownloadsStore } from "../../store/downloadsStore";
import { useUiStore } from "../../store/uiStore";

function DeleteConfirmDialog({
  ids,
  defaultDeleteFiles,
}: {
  ids: string[];
  defaultDeleteFiles: boolean;
}) {
  const [deleteFiles, setDeleteFiles] = useState(defaultDeleteFiles);
  const [busy, setBusy] = useState(false);

  const itemsById = useDownloadsStore((s) => s.itemsById);
  const selectedId = useUiStore((s) => s.selectedId);
  const setSelectedId = useUiStore((s) => s.setSelectedId);
  const closeDeleteConfirm = useUiStore((s) => s.closeDeleteConfirm);
  const pushToast = useUiStore((s) => s.pushToast);

  const targetLabel =
    ids.length === 1
      ? itemsById[ids[0]]?.fileName || "this download"
      : `${ids.length} selected downloads`;

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await ipc.deleteItems(ids, deleteFiles, true);
      if (selectedId && ids.includes(selectedId)) {
        setSelectedId(null);
      }
      pushToast(
        "info",
        deleteFiles
          ? `Deleted ${ids.length === 1 ? targetLabel : `${ids.length} items`} from list and disk`
          : `Removed ${ids.length === 1 ? targetLabel : `${ids.length} items`}`
      );
      closeDeleteConfirm();
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="hdm-delete-title"
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) closeDeleteConfirm();
      }}
    >
      <div className="w-full max-w-sm rounded-md bg-surface-container border border-outline p-5 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded bg-primary-badge border border-primary/40 flex items-center justify-center shrink-0">
            <AlertTriangle size={16} className="text-on-primary-badge" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex flex-col gap-1">
            <h2 id="hdm-delete-title" className="font-title text-title-md text-on-surface">
              Remove Download
            </h2>
            <p className="font-body text-body-sm text-on-surface-variant break-words">
              Remove <span className="text-on-surface font-medium">{targetLabel}</span> from HDM?
            </p>
          </div>
        </div>

        <label className="flex items-center gap-2.5 p-2.5 rounded bg-surface border border-outline cursor-pointer select-none">
          <input
            type="checkbox"
            checked={deleteFiles}
            onChange={(e) => setDeleteFiles(e.target.checked)}
            className="w-4 h-4 accent-[#E11D2E]"
          />
          <span className="font-body text-body-sm text-on-surface">
            Also delete downloaded file(s) from disk
          </span>
        </label>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={closeDeleteConfirm}
            className="h-8 px-3 rounded bg-surface-container-high border border-outline font-label text-label-md text-on-surface-variant hover:text-on-surface disabled:opacity-50 transition-colors duration-state-change ease-state-change"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleConfirm()}
            className="h-8 px-3 rounded bg-primary text-on-primary font-label text-label-md hover:bg-primary/90 disabled:opacity-50 transition-colors duration-state-change ease-state-change"
          >
            {busy ? "Removing…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DeleteConfirmModal() {
  const deleteConfirm = useUiStore((s) => s.deleteConfirm);
  if (!deleteConfirm) return null;

  return (
    <DeleteConfirmDialog
      key={`${deleteConfirm.ids.join(",")}-${deleteConfirm.defaultDeleteFiles}`}
      ids={deleteConfirm.ids}
      defaultDeleteFiles={deleteConfirm.defaultDeleteFiles}
    />
  );
}
