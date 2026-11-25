import { useState } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  FolderOpen,
  ShieldAlert,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import {
  copyItemPath,
  openCompletedItem,
  requestDeleteItems,
  revealItemFolder,
  verifyItemSha256Action,
} from "../../lib/actions";
import {
  formatBytes,
  formatEta,
  formatRelativeTime,
  joinPath,
  protocolBadge,
} from "../../lib/format";
import { ipc } from "../../lib/ipc";
import { scanCompletedItemAction } from "../../lib/security";
import type { DownloadItem } from "../../lib/types";
import { useUiStore } from "../../store/uiStore";

interface CompletedInspectorProps {
  item: DownloadItem;
}

function defaultOllamaModelName(fileName: string): string {
  return fileName
    .replace(/\.gguf$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "hdm-model";
}

export function CompletedInspector({ item }: CompletedInspectorProps) {
  const verification = useUiStore((s) => s.verifiedById[item.id]);
  const verifying = useUiStore((s) => !!s.verifyingIds[item.id]);
  const securityReport = useUiStore((s) => s.securityById[item.id]);
  const scanning = useUiStore((s) => !!s.scanningIds[item.id]);
  const dismissedSecurity = useUiStore((s) => !!s.dismissedSecurityIds[item.id]);
  const dismissSecurityWarning = useUiStore((s) => s.dismissSecurityWarning);
  const pushToast = useUiStore((s) => s.pushToast);

  const isGguf =
    item.kind !== "torrent" && item.fileName.toLowerCase().endsWith(".gguf");
  const [ollamaName, setOllamaName] = useState(() =>
    defaultOllamaModelName(item.fileName)
  );
  const [importingOllama, setImportingOllama] = useState(false);

  const handleImportOllama = async () => {
    if (importingOllama || !ollamaName.trim()) return;
    setImportingOllama(true);
    try {
      const msg = await ipc.ollamaImportGguf(
        ollamaName.trim(),
        joinPath(item.saveDir, item.fileName)
      );
      pushToast("success", msg);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setImportingOllama(false);
    }
  };

  const startMs = item.lastTryAt ?? item.addedAt;
  const elapsedSecs =
    item.finishedAt && startMs && item.finishedAt > startMs
      ? Math.max(1, Math.round((item.finishedAt - startMs) / 1000))
      : null;

  const hashToCopy = verification?.actual ?? item.checksum ?? null;

  const handleCopyHash = async () => {
    if (!hashToCopy) return;
    try {
      await ipc.clipboardWrite(hashToCopy);
      pushToast("success", "Copied SHA-256 hash");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex-1 flex flex-col justify-between min-h-0">
      <div className="p-4 flex flex-col gap-4 overflow-y-auto min-h-0">
        {/* Verification Card */}
        {item.kind === "torrent" ? (
          <div className="rounded-md bg-status-connected-tint border border-status-connected/30 p-3 flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <CheckCircle2
                size={15}
                className="text-status-connected"
                aria-hidden="true"
              />
              <span className="font-label text-label-md text-status-connected">
                Torrent Piece-Verified
              </span>
            </div>
            <span className="font-body text-body-sm text-on-surface-variant">
              Multi-file swarm pieces verified by librqbit upon completion.
            </span>
          </div>
        ) : verification?.matches === true ? (
          <div className="rounded-md bg-status-connected-tint border border-status-connected/30 p-3 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <ShieldCheck
                size={15}
                className="text-status-connected"
                aria-hidden="true"
              />
              <span className="font-label text-label-md text-status-connected">
                SHA-256 Checksum Verified
              </span>
            </div>
            <span className="font-mono text-mono-sm text-on-surface break-all select-all">
              {verification.actual}
            </span>
          </div>
        ) : verification?.matches === false ? (
          <div className="rounded-md bg-primary-tint border border-primary/40 p-3 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <ShieldAlert
                size={15}
                className="text-on-primary-badge"
                aria-hidden="true"
              />
              <span className="font-label text-label-md text-on-primary-badge">
                SHA-256 Mismatch
              </span>
            </div>
            <span className="font-mono text-mono-sm text-on-surface break-all select-all">
              Actual: {verification.actual}
            </span>
            {verification.expected && (
              <span className="font-mono text-mono-sm text-on-surface-variant break-all select-all">
                Expected: {verification.expected}
              </span>
            )}
          </div>
        ) : verification ? (
          <div className="rounded-md bg-surface border border-outline p-3 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <ShieldCheck
                size={15}
                className="text-on-surface-variant"
                aria-hidden="true"
              />
              <span className="font-label text-label-md text-on-surface">
                SHA-256 Digest Computed
              </span>
            </div>
            <span className="font-mono text-mono-sm text-on-surface break-all select-all">
              {verification.actual}
            </span>
          </div>
        ) : (
          <div className="rounded-md bg-surface border border-outline p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-label text-label-md text-on-surface">
                SHA-256 Integrity
              </span>
              {item.checksum && (
                <span className="font-mono text-mono-sm text-status-connected">
                  Expected set
                </span>
              )}
            </div>
            {item.checksum && (
              <span className="font-mono text-mono-sm text-on-surface-variant break-all">
                {item.checksum}
              </span>
            )}
            <button
              type="button"
              disabled={verifying}
              onClick={() => void verifyItemSha256Action(item)}
              className="h-7 px-2.5 rounded bg-surface-container-high border border-outline font-label text-label-sm text-on-surface hover:border-primary/50 disabled:opacity-50 transition-colors duration-state-change ease-state-change"
            >
              {verifying ? "Computing SHA-256…" : "Compute SHA-256"}
            </button>
          </div>
        )}

        {/* Selective Malware Guard Card */}
        {item.kind !== "torrent" && (
          <div
            className={`rounded-md border p-3 flex flex-col gap-2 ${
              securityReport?.verdict === "harmful" && !dismissedSecurity
                ? "bg-primary-tint border-primary/50"
                : securityReport?.verdict === "caution" && !dismissedSecurity
                ? "bg-status-warning-tint border-status-warning/40"
                : securityReport?.verdict === "clean"
                ? "bg-status-connected-tint border-status-connected/30"
                : "bg-surface border-outline"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                {securityReport?.verdict === "harmful" ||
                securityReport?.verdict === "caution" ? (
                  <ShieldAlert
                    size={15}
                    className={
                      securityReport.verdict === "harmful"
                        ? "text-on-primary-badge shrink-0"
                        : "text-status-warning shrink-0"
                    }
                    aria-hidden="true"
                  />
                ) : (
                  <ShieldCheck
                    size={15}
                    className={
                      securityReport?.verdict === "clean"
                        ? "text-status-connected shrink-0"
                        : "text-on-surface-variant shrink-0"
                    }
                    aria-hidden="true"
                  />
                )}
                <span
                  className={`font-label text-label-md truncate ${
                    securityReport?.verdict === "harmful" && !dismissedSecurity
                      ? "text-on-primary-badge"
                      : securityReport?.verdict === "caution" && !dismissedSecurity
                      ? "text-status-warning"
                      : securityReport?.verdict === "clean"
                      ? "text-status-connected"
                      : "text-on-surface"
                  }`}
                >
                  {!securityReport
                    ? "Malware Guard"
                    : securityReport.verdict === "harmful"
                    ? dismissedSecurity
                      ? "Threat Dismissed (Kept)"
                      : "Harmful Threat Detected"
                    : securityReport.verdict === "caution"
                    ? dismissedSecurity
                      ? "Warning Dismissed (Kept)"
                      : "Suspicious Script / File"
                    : "No Real Threats Found"}
                </span>
              </div>
              <button
                type="button"
                disabled={scanning}
                onClick={() => void scanCompletedItemAction(item)}
                className="h-6 px-2 rounded-sm bg-surface-container-high border border-outline font-label text-label-sm text-on-surface hover:border-primary/50 disabled:opacity-50 shrink-0"
              >
                {scanning ? "Scanning…" : securityReport ? "Re-scan" : "Scan File"}
              </button>
            </div>

            {!securityReport ? (
              <span className="font-body text-body-sm text-on-surface-variant">
                Checks MalwareBazaar + local stealer/ransomware heuristics while ignoring harmless game crack labels.
              </span>
            ) : (
              <>
                {securityReport.findings.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {securityReport.findings.map((f, idx) => (
                      <div
                        key={idx}
                        className="rounded bg-surface/80 border border-outline/80 px-2.5 py-1.5 flex flex-col gap-0.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-label text-label-sm text-on-surface">
                            {f.title}
                          </span>
                          <span className="font-mono text-mono-sm text-on-surface-variant shrink-0">
                            {f.source}
                          </span>
                        </div>
                        <span className="font-body text-body-sm text-on-surface-variant">
                          {f.detail}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <span className="font-mono text-mono-sm text-on-surface-variant">
                  Checked: {securityReport.checkedSources.join(" + ")}
                  {securityReport.ignoredCrackLabels > 0
                    ? ` · ${securityReport.ignoredCrackLabels} crack/hacktool label${securityReport.ignoredCrackLabels === 1 ? "" : "s"} ignored`
                    : ""}
                </span>

                {securityReport.verdict !== "clean" && !dismissedSecurity && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        dismissSecurityWarning(item.id);
                        pushToast("info", `Kept ${item.fileName}`);
                      }}
                      className="h-7 px-2 rounded bg-surface-container-high border border-outline font-label text-label-sm text-on-surface hover:border-primary/40"
                    >
                      Keep File
                    </button>
                    <button
                      type="button"
                      onClick={() => void requestDeleteItems([item.id], true)}
                      className="h-7 px-2 rounded bg-primary text-on-primary font-label text-label-sm hover:bg-primary/90"
                    >
                      Delete File
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Honest Metadata Grid */}
        <div className="rounded-md bg-surface border border-outline p-3 grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="font-label text-label-sm text-on-surface-variant">
              Duration
            </span>
            <span className="font-mono text-mono-md tabular text-on-surface">
              {elapsedSecs != null ? formatEta(elapsedSecs) : "—"}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-label text-label-sm text-on-surface-variant">
              Total Size
            </span>
            <span className="font-mono text-mono-md tabular text-on-surface">
              {formatBytes(item.size ?? item.downloaded)}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-label text-label-sm text-on-surface-variant">
              Threads
            </span>
            <span className="font-mono text-mono-md tabular text-on-surface">
              {item.connections} {protocolBadge(item)}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-label text-label-sm text-on-surface-variant">
              Completed
            </span>
            <span className="font-mono text-mono-md tabular text-on-surface">
              {formatRelativeTime(item.finishedAt ?? item.addedAt)}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
              Saved Path
            </span>
            <div className="font-mono text-mono-sm text-on-surface-variant bg-surface border border-outline rounded p-2 break-all select-all">
              {joinPath(item.saveDir, item.fileName)}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
              Source URL
            </span>
            <div className="font-mono text-mono-sm text-on-surface-variant bg-surface border border-outline rounded p-2 break-all select-all max-h-20 overflow-y-auto">
              {item.url}
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-outline flex flex-col gap-2 shrink-0">
        <button
          type="button"
          onClick={() => void openCompletedItem(item)}
          className="inline-flex items-center justify-center gap-1.5 h-8 w-full px-3 rounded bg-primary text-on-primary font-label text-label-md hover:bg-primary/90 transition-colors duration-state-change ease-state-change"
        >
          <ExternalLink size={14} aria-hidden="true" />
          <span>Open File</span>
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void revealItemFolder(item)}
            className="inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded bg-surface-container-high border border-outline text-on-surface font-label text-label-md hover:border-primary/40 transition-colors duration-state-change ease-state-change"
          >
            <FolderOpen size={14} className="text-on-surface-variant" aria-hidden="true" />
            <span>Show in Folder</span>
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

        {item.kind !== "torrent" && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!hashToCopy}
              onClick={() => void handleCopyHash()}
              className="h-8 px-2.5 rounded bg-surface border border-outline font-label text-label-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high disabled:opacity-40 transition-colors duration-state-change ease-state-change"
            >
              Copy Hash
            </button>
            <button
              type="button"
              disabled={verifying}
              onClick={() => void verifyItemSha256Action(item)}
              className="h-8 px-2.5 rounded bg-surface border border-outline font-label text-label-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high disabled:opacity-40 transition-colors duration-state-change ease-state-change"
            >
              {verifying ? "Hashing…" : "Re-verify"}
            </button>
          </div>
        )}

        {isGguf && (
          <div className="pt-1 flex flex-col gap-1.5 border-t border-outline-subtle">
            <span className="font-label text-label-sm text-on-surface-variant">
              Import GGUF into Local Ollama
            </span>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={ollamaName}
                onChange={(e) => setOllamaName(e.target.value)}
                aria-label="Local Ollama model name"
                placeholder="model:tag"
                className="flex-1 h-8 px-2 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface focus:outline-none focus:border-primary min-w-0"
              />
              <button
                type="button"
                disabled={importingOllama || !ollamaName.trim()}
                onClick={() => void handleImportOllama()}
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded bg-primary-tint border border-primary/40 font-label text-label-sm text-on-primary-badge hover:bg-primary/20 disabled:opacity-40 shrink-0"
              >
                <Terminal size={12} aria-hidden="true" />
                <span>{importingOllama ? "Importing…" : "Import"}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
