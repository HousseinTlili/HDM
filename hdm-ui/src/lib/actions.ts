import { isActiveStatus, isQueuedStatus, joinPath } from "./format";
import { ipc } from "./ipc";
import type { DownloadItem } from "./types";
import { useDownloadsStore } from "../store/downloadsStore";
import { useUiStore } from "../store/uiStore";

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function canPauseItem(item: DownloadItem): boolean {
  return isActiveStatus(item.status) || isQueuedStatus(item.status);
}

export function canResumeItem(item: DownloadItem): boolean {
  return item.status === "paused" || item.status === "idle" || item.status === "failed";
}

export async function toggleItemTransfer(item: DownloadItem): Promise<void> {
  const { pushToast } = useUiStore.getState();
  try {
    if (canPauseItem(item)) {
      await ipc.pauseItems([item.id]);
    } else if (canResumeItem(item)) {
      await ipc.startItems([item.id]);
    }
  } catch (err) {
    pushToast("error", errMsg(err));
  }
}

export async function redownloadItem(item: DownloadItem): Promise<void> {
  const { pushToast } = useUiStore.getState();
  try {
    await ipc.redownload(item.id);
    pushToast("info", `Restarted ${item.fileName || "download"}`);
  } catch (err) {
    pushToast("error", errMsg(err));
  }
}

export async function openCompletedItem(item: DownloadItem): Promise<void> {
  const { pushToast } = useUiStore.getState();
  try {
    await ipc.openItem(item.id);
  } catch (err) {
    pushToast("error", errMsg(err));
  }
}

export async function revealItemFolder(item: DownloadItem): Promise<void> {
  const { pushToast } = useUiStore.getState();
  try {
    await ipc.revealItem(item.id);
  } catch (err) {
    pushToast("error", errMsg(err));
  }
}

export async function copyItemPath(item: DownloadItem): Promise<void> {
  const { pushToast } = useUiStore.getState();
  try {
    await ipc.clipboardWrite(joinPath(item.saveDir, item.fileName));
    pushToast("success", "Copied file path");
  } catch (err) {
    pushToast("error", errMsg(err));
  }
}

export async function copyItemUrl(item: DownloadItem): Promise<void> {
  const { pushToast } = useUiStore.getState();
  try {
    await ipc.clipboardWrite(item.url);
    pushToast("success", "Copied source URL");
  } catch (err) {
    pushToast("error", errMsg(err));
  }
}

export async function verifyItemSha256Action(item: DownloadItem): Promise<void> {
  const ui = useUiStore.getState();
  if (item.status !== "completed" || item.kind === "torrent" || ui.verifyingIds[item.id]) {
    return;
  }
  ui.setVerifying(item.id, true);
  try {
    const result = await ipc.verifyItemSha256(item.id);
    useUiStore.getState().setVerification(item.id, result);
    if (result.matches === true) {
      useUiStore.getState().pushToast("success", `SHA-256 verified: ${item.fileName}`);
    } else if (result.matches === false) {
      useUiStore.getState().pushToast("error", `SHA-256 mismatch: ${item.fileName}`);
    } else {
      useUiStore
        .getState()
        .pushToast("info", `SHA-256: ${result.actual.slice(0, 16)}…`);
    }
  } catch (err) {
    useUiStore.getState().pushToast("error", errMsg(err));
  } finally {
    useUiStore.getState().setVerifying(item.id, false);
  }
}

export async function requestDeleteItems(
  ids: string[],
  forceConfirmWithFiles = false
): Promise<void> {
  if (ids.length === 0) return;
  const ui = useUiStore.getState();
  const confirmDelete =
    useDownloadsStore.getState().settings?.general.confirmDelete ?? true;

  if (forceConfirmWithFiles || confirmDelete) {
    ui.openDeleteConfirm(ids, forceConfirmWithFiles);
    return;
  }

  try {
    await ipc.deleteItems(ids, false, true);
    if (ui.selectedId && ids.includes(ui.selectedId)) {
      ui.setSelectedId(null);
    }
    ui.pushToast("info", ids.length === 1 ? "Removed from list" : `Removed ${ids.length} items`);
  } catch (err) {
    ui.pushToast("error", errMsg(err));
  }
}
