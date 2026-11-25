import { joinPath } from "./format";
import { ipc } from "./ipc";
import type { DownloadItem, SecurityScanReport } from "./types";
import { useUiStore } from "../store/uiStore";

const AUTO_SCAN_KEY = "hdm.security.autoScan";
const VT_API_KEY = "hdm.security.vtApiKey";

const AUTO_SCAN_EXTENSIONS = new Set([
  "exe",
  "msi",
  "scr",
  "pif",
  "bat",
  "cmd",
  "ps1",
  "vbs",
  "vbe",
  "js",
  "jse",
  "hta",
  "wsf",
  "lnk",
  "dll",
  "com",
]);

export function getAutoScanEnabled(): boolean {
  try {
    const raw = localStorage.getItem(AUTO_SCAN_KEY);
    return raw == null ? true : raw === "1";
  } catch {
    return true;
  }
}

export function setAutoScanEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_SCAN_KEY, enabled ? "1" : "0");
  } catch {
    // ignore storage errors
  }
}

export function getVirusTotalApiKey(): string {
  try {
    return localStorage.getItem(VT_API_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setVirusTotalApiKey(key: string): void {
  try {
    const trimmed = key.trim();
    if (trimmed) localStorage.setItem(VT_API_KEY, trimmed);
    else localStorage.removeItem(VT_API_KEY);
  } catch {
    // ignore storage errors
  }
}

export function shouldAutoScanFile(fileName: string): boolean {
  const lower = fileName.trim().toLowerCase();
  const idx = lower.lastIndexOf(".");
  if (idx < 0 || idx === lower.length - 1) return false;
  return AUTO_SCAN_EXTENSIONS.has(lower.slice(idx + 1));
}

export async function scanCompletedItemAction(
  item: DownloadItem,
  options?: { silentIfClean?: boolean }
): Promise<SecurityScanReport | null> {
  const ui = useUiStore.getState();
  if (ui.scanningIds[item.id]) return null;
  ui.setScanning(item.id, true);
  try {
    const fullPath = joinPath(item.saveDir, item.fileName);
    const report = await ipc.scanDownloadedFile(fullPath, getVirusTotalApiKey());
    ui.setSecurityReport(item.id, report);

    if (report.verdict === "harmful") {
      ui.pushToast(
        "error",
        `Malware Guard: real threat detected in ${item.fileName} — inspect to keep or delete`
      );
    } else if (report.verdict === "caution") {
      ui.pushToast(
        "info",
        `Malware Guard: review ${item.fileName} (suspicious script/shortcut type)`
      );
    } else if (!options?.silentIfClean) {
      const crackNote =
        report.ignoredCrackLabels > 0
          ? ` (${report.ignoredCrackLabels} crack/hacktool label${report.ignoredCrackLabels === 1 ? "" : "s"} ignored)`
          : "";
      ui.pushToast("success", `Malware Guard: ${item.fileName} is clean${crackNote}`);
    }
    return report;
  } catch (err) {
    if (!options?.silentIfClean) {
      ui.pushToast("error", err instanceof Error ? err.message : String(err));
    }
    return null;
  } finally {
    ui.setScanning(item.id, false);
  }
}
