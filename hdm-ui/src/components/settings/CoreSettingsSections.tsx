import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { pickFolder } from "../../lib/dialog";
import { formatSpeed } from "../../lib/format";
import { ipc } from "../../lib/ipc";
import {
  getAutoScanEnabled,
  getVirusTotalApiKey,
  setAutoScanEnabled,
  setVirusTotalApiKey,
} from "../../lib/security";
import type { Category, ConflictAction, Settings } from "../../lib/types";
import { useDownloadsStore } from "../../store/downloadsStore";
import { useUiStore } from "../../store/uiStore";
import { SettingRow, SettingsCard, ToggleSwitch } from "./SettingControls";

interface SettingsDraftProps {
  draft: Settings;
  onUpdate: (updater: (prev: Settings) => Settings) => void;
}

export function EngineSection({
  draft,
  onUpdate,
  mainMaxConcurrent,
  onChangeMainMaxConcurrent,
}: SettingsDraftProps & {
  mainMaxConcurrent: number;
  onChangeMainMaxConcurrent: (n: number) => void;
}) {
  const speedLimitMb =
    draft.downloads.speedLimit > 0
      ? Number((draft.downloads.speedLimit / (1024 * 1024)).toFixed(2))
      : 0;

  const applySpeedPreset = (preset: "conservative" | "balanced" | "turbo") => {
    if (preset === "conservative") {
      onUpdate((prev) => ({
        ...prev,
        downloads: { ...prev.downloads, defaultConnections: 8, maxConnections: 16, maxRetries: 15 },
        connection: { ...prev.connection, connectTimeoutSecs: 15, readTimeoutSecs: 30, httpVersion: "http1" },
      }));
      onChangeMainMaxConcurrent(3);
    } else if (preset === "balanced") {
      onUpdate((prev) => ({
        ...prev,
        downloads: { ...prev.downloads, defaultConnections: 16, maxConnections: 32, maxRetries: 20 },
        connection: { ...prev.connection, connectTimeoutSecs: 10, readTimeoutSecs: 15, httpVersion: "http1" },
      }));
      onChangeMainMaxConcurrent(4);
    } else {
      onUpdate((prev) => ({
        ...prev,
        downloads: {
          ...prev.downloads,
          defaultConnections: 32,
          maxConnections: 32,
          maxRetries: 25,
          speedLimiterEnabled: false,
        },
        connection: {
          ...prev.connection,
          connectTimeoutSecs: 10,
          readTimeoutSecs: 15,
          httpVersion: "http1",
          maxConnectionsPerHost: 0,
        },
      }));
      onChangeMainMaxConcurrent(6);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard title="Speed & Stability Presets">
        <SettingRow
          title="Throughput Profile"
          description="Apply tuned multi-segment, timeout, and concurrency defaults (click Save Changes after selecting)"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => applySpeedPreset("conservative")}
              className={`h-8 px-3 rounded border font-label text-label-sm transition-colors duration-state-change ${
                draft.downloads.defaultConnections <= 8
                  ? "bg-primary-tint border-primary text-on-primary-badge"
                  : "bg-surface border-outline text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
              }`}
            >
              Conservative (8x)
            </button>
            <button
              type="button"
              onClick={() => applySpeedPreset("balanced")}
              className={`h-8 px-3 rounded border font-label text-label-sm transition-colors duration-state-change ${
                draft.downloads.defaultConnections === 16
                  ? "bg-primary-tint border-primary text-on-primary-badge"
                  : "bg-surface border-outline text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
              }`}
            >
              Balanced (16x)
            </button>
            <button
              type="button"
              onClick={() => applySpeedPreset("turbo")}
              className={`h-8 px-3 rounded border font-label text-label-sm transition-colors duration-state-change ${
                draft.downloads.defaultConnections >= 32
                  ? "bg-primary-tint border-primary text-on-primary-badge"
                  : "bg-surface border-outline text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
              }`}
            >
              Max Speed Turbo (32x)
            </button>
          </div>
        </SettingRow>
      </SettingsCard>

      <SettingsCard title="Concurrency & Speed">
        <SettingRow
          title="Default Threads Per Download"
          description="Parallel range connections opened per task (engine max 32)"
        >
          <select
            aria-label="Default threads per download"
            value={Math.min(32, Math.max(1, draft.downloads.defaultConnections))}
            onChange={(e) => {
              const val = Math.min(32, Math.max(1, Number(e.target.value)));
              onUpdate((prev) => ({
                ...prev,
                downloads: {
                  ...prev.downloads,
                  defaultConnections: val,
                  maxConnections: Math.max(prev.downloads.maxConnections, val),
                },
              }));
            }}
            className="h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface focus:outline-none focus:border-primary"
          >
            {[1, 4, 8, 16, 32].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "Thread" : "Threads"}
              </option>
            ))}
          </select>
        </SettingRow>

        <SettingRow
          title="Max Connections Limit"
          description="Upper bound applied by the transfer engine across all downloads"
        >
          <select
            aria-label="Maximum connections cap"
            value={Math.min(32, Math.max(1, draft.downloads.maxConnections))}
            onChange={(e) => {
              const val = Math.min(32, Math.max(1, Number(e.target.value)));
              onUpdate((prev) => ({
                ...prev,
                downloads: { ...prev.downloads, maxConnections: val },
              }));
            }}
            className="h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface focus:outline-none focus:border-primary"
          >
            {[8, 16, 32].map((n) => (
              <option key={n} value={n}>
                {n} Threads
              </option>
            ))}
          </select>
        </SettingRow>

        <SettingRow
          title="Max Concurrent Active Tasks"
          description="Queued items wait until an active slot in Main Queue opens"
        >
          <input
            type="number"
            min={1}
            max={16}
            value={mainMaxConcurrent}
            onChange={(e) =>
              onChangeMainMaxConcurrent(
                Math.min(16, Math.max(1, Number(e.target.value) || 1))
              )
            }
            aria-label="Max concurrent active tasks"
            className="w-20 h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm tabular text-on-surface text-right focus:outline-none focus:border-primary"
          />
        </SettingRow>

        <SettingRow
          title="Global Speed Limiter"
          description="Throttle total HTTP/torrent bandwidth when enabled from toolbar or tray"
        >
          <ToggleSwitch
            checked={draft.downloads.speedLimiterEnabled}
            onChange={(checked) =>
              onUpdate((prev) => ({
                ...prev,
                downloads: { ...prev.downloads, speedLimiterEnabled: checked },
              }))
            }
            label="Enable global speed limiter"
          />
          <input
            type="number"
            min={0}
            step={0.5}
            value={speedLimitMb}
            onChange={(e) => {
              const mb = Math.max(0, Number(e.target.value) || 0);
              onUpdate((prev) => ({
                ...prev,
                downloads: {
                  ...prev.downloads,
                  speedLimit: Math.round(mb * 1024 * 1024),
                },
              }));
            }}
            aria-label="Global speed limit in MB/s"
            className="w-24 h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm tabular text-on-surface text-right focus:outline-none focus:border-primary"
          />
          <span className="font-mono text-mono-sm text-on-surface-variant">
            MB/s
          </span>
        </SettingRow>

        <SettingRow
          title="Automatic Retries"
          description="Retry attempts per transient network interruption"
        >
          <input
            type="number"
            min={0}
            max={100}
            value={draft.downloads.maxRetries}
            onChange={(e) =>
              onUpdate((prev) => ({
                ...prev,
                downloads: {
                  ...prev.downloads,
                  maxRetries: Math.max(0, Number(e.target.value) || 0),
                },
              }))
            }
            aria-label="Automatic retries"
            className="w-20 h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm tabular text-on-surface text-right focus:outline-none focus:border-primary"
          />
        </SettingRow>
      </SettingsCard>

      <SettingsCard title="Integrity, Startup & Behavior">
        <SettingRow
          title="Automatic Checksum Verification"
          description="Verify expected MD5/SHA-1/SHA-256 digests immediately on completion"
        >
          <ToggleSwitch
            checked={draft.downloads.verifyChecksums}
            onChange={(checked) =>
              onUpdate((prev) => ({
                ...prev,
                downloads: { ...prev.downloads, verifyChecksums: checked },
              }))
            }
            label="Automatic checksum verification"
          />
        </SettingRow>

        <SettingRow
          title="Launch HDM at Login"
          description="Start HDM silently in the background when you sign in"
        >
          <ToggleSwitch
            checked={draft.general.launchAtStartup}
            onChange={(checked) =>
              onUpdate((prev) => ({
                ...prev,
                general: { ...prev.general, launchAtStartup: checked },
              }))
            }
            label="Launch at startup"
          />
        </SettingRow>

        <SettingRow
          title="Close Window to System Tray"
          description="Keep transfers and browser interception running when closing the main window"
        >
          <ToggleSwitch
            checked={draft.general.closeToTray}
            onChange={(checked) =>
              onUpdate((prev) => ({
                ...prev,
                general: { ...prev.general, closeToTray: checked },
              }))
            }
            label="Close to tray"
          />
        </SettingRow>

        <SettingRow
          title="Desktop Notifications"
          description="Notify on completion, failure, and finished queues"
        >
          <ToggleSwitch
            checked={draft.general.notifications}
            onChange={(checked) =>
              onUpdate((prev) => ({
                ...prev,
                general: { ...prev.general, notifications: checked },
              }))
            }
            label="Desktop notifications"
          />
        </SettingRow>

        <SettingRow
          title="Confirm Before Deleting Items"
          description="Show confirmation prompt before removing downloads or local files"
        >
          <ToggleSwitch
            checked={draft.general.confirmDelete}
            onChange={(checked) =>
              onUpdate((prev) => ({
                ...prev,
                general: { ...prev.general, confirmDelete: checked },
              }))
            }
            label="Confirm delete"
          />
        </SettingRow>

        <SettingRow
          title="Monitor Clipboard for Links"
          description="Detect copied HTTP/FTP/Magnet links automatically"
        >
          <ToggleSwitch
            checked={draft.clipboard.monitor}
            onChange={(checked) =>
              onUpdate((prev) => ({
                ...prev,
                clipboard: { ...prev.clipboard, monitor: checked },
              }))
            }
            label="Monitor clipboard"
          />
        </SettingRow>
      </SettingsCard>
    </div>
  );
}

export function DirectoriesSection({
  draft,
  onUpdate,
  categoryDrafts,
  onChangeCategoryDir,
  dataDir,
}: SettingsDraftProps & {
  categoryDrafts: Category[];
  onChangeCategoryDir: (id: string, saveDir: string | null) => void;
  dataDir: string;
}) {
  const pushToast = useUiStore((s) => s.pushToast);

  const browseDefault = async () => {
    const picked = await pickFolder(draft.downloads.defaultDir);
    if (picked) {
      onUpdate((prev) => ({
        ...prev,
        downloads: { ...prev.downloads, defaultDir: picked },
      }));
    }
  };

  const openPathSafe = async (path: string) => {
    if (!path) return;
    try {
      await ipc.openPath(path);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard title="Download Storage">
        <SettingRow
          title="Default Download Directory"
          description="Fallback output directory when no category override is set"
        >
          <input
            type="text"
            value={draft.downloads.defaultDir}
            onChange={(e) =>
              onUpdate((prev) => ({
                ...prev,
                downloads: { ...prev.downloads, defaultDir: e.target.value },
              }))
            }
            aria-label="Default download directory"
            className="w-72 h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface focus:outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={() => void browseDefault()}
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded bg-surface-container-high border border-outline font-label text-label-sm text-on-surface hover:border-primary/40"
          >
            <FolderOpen size={13} aria-hidden="true" />
            <span>Browse</span>
          </button>
        </SettingRow>

        <SettingRow
          title="Sort Files Into Category Subfolders"
          description="Route downloads into matching category folders (Compressed, Video, Programs…)"
        >
          <ToggleSwitch
            checked={draft.downloads.useCategoryFolders}
            onChange={(checked) =>
              onUpdate((prev) => ({
                ...prev,
                downloads: { ...prev.downloads, useCategoryFolders: checked },
              }))
            }
            label="Use category folders"
          />
        </SettingRow>

        <SettingRow
          title="File Name Conflict Rule"
          description="Default action when a file with the same name already exists"
        >
          <select
            aria-label="File conflict behavior"
            value={draft.downloads.conflict}
            onChange={(e) =>
              onUpdate((prev) => ({
                ...prev,
                downloads: {
                  ...prev.downloads,
                  conflict: e.target.value as ConflictAction,
                },
              }))
            }
            className="h-8 px-2.5 rounded bg-surface border border-outline font-label text-label-md text-on-surface focus:outline-none focus:border-primary"
          >
            <option value="ask">Ask</option>
            <option value="rename">Auto-Rename</option>
            <option value="overwrite">Overwrite</option>
          </select>
        </SettingRow>

        <SettingRow
          title="HDM State & SQLite Database Folder"
          description={dataDir || "Local application data path"}
        >
          <button
            type="button"
            disabled={!dataDir}
            onClick={() => void openPathSafe(dataDir)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-surface-container-high border border-outline font-label text-label-sm text-on-surface hover:border-primary/40 disabled:opacity-40"
          >
            <FolderOpen size={13} aria-hidden="true" />
            <span>Open Data Dir</span>
          </button>
        </SettingRow>
      </SettingsCard>

      {categoryDrafts.length > 0 && (
        <SettingsCard title="Category Overrides">
          {categoryDrafts.map((cat) => (
            <SettingRow
              key={cat.id}
              title={cat.name}
              description={cat.extensions.join(", ") || "All unmatched files"}
            >
              <input
                type="text"
                value={cat.saveDir ?? ""}
                placeholder="(Default subfolder)"
                onChange={(e) =>
                  onChangeCategoryDir(
                    cat.id,
                    e.target.value.trim() ? e.target.value : null
                  )
                }
                aria-label={`${cat.name} save directory`}
                className="w-60 h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => {
                  void pickFolder(
                    cat.saveDir || draft.downloads.defaultDir
                  ).then((picked) => {
                    if (picked) onChangeCategoryDir(cat.id, picked);
                  });
                }}
                aria-label={`Browse ${cat.name} directory`}
                className="inline-flex items-center justify-center w-8 h-8 rounded bg-surface-container-high border border-outline text-on-surface-variant hover:text-on-surface"
              >
                <FolderOpen size={13} aria-hidden="true" />
              </button>
            </SettingRow>
          ))}
        </SettingsCard>
      )}
    </div>
  );
}

export function TorrentSection({
  draft,
  dataDir,
}: {
  draft: Settings;
  dataDir: string;
}) {
  const itemsById = useDownloadsStore((s) => s.itemsById);
  const itemOrder = useDownloadsStore((s) => s.itemOrder);
  const pushToast = useUiStore((s) => s.pushToast);

  const torrents = itemOrder
    .map((id) => itemsById[id])
    .filter((i) => i && !i.trashed && i.kind === "torrent" && i.status !== "completed");
  const [selectedTorrentId, setSelectedTorrentId] = useState<string>(
    () => torrents[0]?.id ?? ""
  );
  const activeTorrent =
    (selectedTorrentId ? itemsById[selectedTorrentId] : undefined) ?? torrents[0];

  const sequential = Boolean(activeTorrent?.request?.sequential);
  const savedDlBps =
    typeof activeTorrent?.request?.maxDlBps === "number"
      ? activeTorrent.request.maxDlBps
      : 0;
  const savedUlBps =
    typeof activeTorrent?.request?.maxUlBps === "number"
      ? activeTorrent.request.maxUlBps
      : 0;
  const savedTrackers = Array.isArray(activeTorrent?.request?.extraTrackers)
    ? (activeTorrent.request.extraTrackers as string[])
    : [];

  const [dlDraft, setDlDraft] = useState(() =>
    savedDlBps > 0 ? Number((savedDlBps / (1024 * 1024)).toFixed(2)).toString() : "0"
  );
  const [ulDraft, setUlDraft] = useState(() =>
    savedUlBps > 0 ? Number((savedUlBps / (1024 * 1024)).toFixed(2)).toString() : "0"
  );
  const [trackersDraft, setTrackersDraft] = useState(() => savedTrackers.join("\n"));

  const selectTorrent = (id: string) => {
    setSelectedTorrentId(id);
    const t = itemsById[id];
    const dl = typeof t?.request?.maxDlBps === "number" ? t.request.maxDlBps : 0;
    const ul = typeof t?.request?.maxUlBps === "number" ? t.request.maxUlBps : 0;
    const tr = Array.isArray(t?.request?.extraTrackers)
      ? (t.request.extraTrackers as string[])
      : [];
    setDlDraft(dl > 0 ? Number((dl / (1024 * 1024)).toFixed(2)).toString() : "0");
    setUlDraft(ul > 0 ? Number((ul / (1024 * 1024)).toFixed(2)).toString() : "0");
    setTrackersDraft(tr.join("\n"));
  };

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard title="High-Speed BitTorrent Engine">
        <SettingRow
          title="Peer Discovery & Transport"
          description="Bundled C++ aria2c engine with MSE/PE encryption, pure TCP pipelining, 64 MiB disk cache, unlimited peer hunting, top-20 public trackers, and outbound-only firewall safety (zero router ports opened)"
        >
          <span className="font-mono text-mono-sm px-2.5 py-1 rounded-sm bg-status-connected-tint border border-status-connected/30 text-status-connected">
            aria2c C++ · MSE/PE · TCP · Outbound-Only
          </span>
        </SettingRow>

        <SettingRow
          title="Fast-Resume Persistence"
          description="Swarm bitfields and session metadata checkpointed on exit and pause"
        >
          <span className="font-mono text-mono-sm px-2.5 py-1 rounded-sm bg-surface border border-outline text-on-surface">
            {dataDir ? `${dataDir}${dataDir.includes("\\") ? "\\" : "/"}torrents` : "dataDir/torrents"}
          </span>
        </SettingRow>

        <SettingRow
          title="Bandwidth Cap Sync"
          description="Global speed limiter applies to both torrent DL/UL and HTTP segments"
        >
          <span className="font-mono text-mono-sm tabular px-2.5 py-1 rounded-sm bg-surface border border-outline text-on-surface">
            {draft.downloads.speedLimiterEnabled
              ? `Capped @ ${formatSpeed(draft.downloads.speedLimit)}`
              : "Unthrottled"}
          </span>
        </SettingRow>
      </SettingsCard>

      <SettingsCard title="Swarm Controls (Per-Torrent)">
        {torrents.length === 0 ? (
          <div className="px-4 py-3 font-body text-body-sm text-on-surface-variant">
            No active or paused torrents right now. Add a torrent to configure sequential mode, per-torrent speed caps, or extra trackers here.
          </div>
        ) : (
          <>
            <SettingRow
              title="Target Torrent"
              description="Select which torrent's swarm options to adjust"
            >
              <select
                value={activeTorrent?.id ?? ""}
                onChange={(e) => selectTorrent(e.target.value)}
                className="w-72 h-8 px-2.5 rounded bg-surface border border-outline font-label text-label-md text-on-surface"
              >
                {torrents.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.fileName || t.url}
                  </option>
                ))}
              </select>
            </SettingRow>

            <SettingRow
              title="Sequential Download (Head & Tail First)"
              description="Prioritize the start and end pieces so media files can be previewed early"
            >
              <ToggleSwitch
                checked={sequential}
                onChange={(checked) => {
                  if (!activeTorrent) return;
                  void ipc
                    .setTorrentOptions({ id: activeTorrent.id, sequential: checked })
                    .then(() =>
                      pushToast(
                        "info",
                        checked
                          ? "Sequential mode ON (head & tail prioritized)"
                          : "Sequential mode OFF (rarest-first)"
                      )
                    )
                    .catch((err) =>
                      pushToast("error", err instanceof Error ? err.message : String(err))
                    );
                }}
                label="Toggle sequential download"
              />
            </SettingRow>

            <SettingRow
              title="Per-Torrent DL / UL Caps (MB/s)"
              description="Set 0 for unlimited speed on this torrent"
            >
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={dlDraft}
                  onChange={(e) => setDlDraft(e.target.value)}
                  aria-label="Per-torrent download cap MB/s"
                  className="w-20 h-8 px-2 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface"
                />
                <span className="font-mono text-mono-sm text-on-surface-variant">DL</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={ulDraft}
                  onChange={(e) => setUlDraft(e.target.value)}
                  aria-label="Per-torrent upload cap MB/s"
                  className="w-20 h-8 px-2 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface"
                />
                <span className="font-mono text-mono-sm text-on-surface-variant">UL</span>
                <button
                  type="button"
                  onClick={() => {
                    if (!activeTorrent) return;
                    const dlMb = Number(dlDraft);
                    const ulMb = Number(ulDraft);
                    void ipc
                      .setTorrentOptions({
                        id: activeTorrent.id,
                        maxDlBps:
                          Number.isFinite(dlMb) && dlMb > 0
                            ? Math.round(dlMb * 1024 * 1024)
                            : 0,
                        maxUlBps:
                          Number.isFinite(ulMb) && ulMb > 0
                            ? Math.round(ulMb * 1024 * 1024)
                            : 0,
                      })
                      .then(() => pushToast("success", "Updated per-torrent speed limits"))
                      .catch((err) =>
                        pushToast("error", err instanceof Error ? err.message : String(err))
                      );
                  }}
                  className="h-8 px-3 rounded bg-surface-container-high border border-outline font-label text-label-sm text-on-surface hover:border-primary/40"
                >
                  Apply
                </button>
              </div>
            </SettingRow>

            <SettingRow
              title="Extra Trackers & Re-announce"
              description="Add custom tracker URLs (one per line) and re-announce to find more peers"
            >
              <div className="flex items-center gap-2">
                <textarea
                  rows={2}
                  value={trackersDraft}
                  onChange={(e) => setTrackersDraft(e.target.value)}
                  placeholder="udp://tracker.example:1337/announce"
                  className="w-60 p-2 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface placeholder:text-on-surface-variant resize-none focus:outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!activeTorrent) return;
                    const list = trackersDraft
                      .split(/[\r\n,]+/)
                      .map((s) => s.trim())
                      .filter(Boolean);
                    void ipc
                      .setTorrentOptions({
                        id: activeTorrent.id,
                        extraTrackers: list,
                      })
                      .then(() =>
                        pushToast(
                          "success",
                          list.length > 0
                            ? `Added ${list.length} tracker(s) & re-announced`
                            : "Cleared custom trackers"
                        )
                      )
                      .catch((err) =>
                        pushToast("error", err instanceof Error ? err.message : String(err))
                      );
                  }}
                  className="h-8 px-3 rounded bg-surface-container-high border border-outline font-label text-label-sm text-on-surface hover:border-primary/40"
                >
                  Re-announce
                </button>
              </div>
            </SettingRow>
          </>
        )}
      </SettingsCard>
    </div>
  );
}

export function NetworkSection({ draft, onUpdate }: SettingsDraftProps) {
  const [autoScan, setAutoScan] = useState(() => getAutoScanEnabled());
  const [vtKey, setVtKey] = useState(() => getVirusTotalApiKey());
  const pushToast = useUiStore((s) => s.pushToast);

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard title="Malware Guard (Selective)">
        <SettingRow
          title="Auto-Scan Completed Executables & Scripts"
          description="Checks MalwareBazaar + local stealer/ransomware heuristics. Ignores harmless game cracks (HackTool/Crack/Keygen) and never auto-deletes files."
        >
          <ToggleSwitch
            checked={autoScan}
            onChange={(checked) => {
              setAutoScan(checked);
              setAutoScanEnabled(checked);
            }}
            label="Auto-scan completed executables"
          />
        </SettingRow>

        <SettingRow
          title="VirusTotal API Key (Optional)"
          description="Optional free key for multi-engine hash reputation (pure HackTool/Crack/PUA labels are automatically filtered out). Stored locally only."
        >
          <input
            type="password"
            value={vtKey}
            placeholder="Optional VirusTotal v3 API key"
            onChange={(e) => setVtKey(e.target.value)}
            onBlur={() => {
              setVirusTotalApiKey(vtKey);
              pushToast(
                "info",
                vtKey.trim()
                  ? "Saved VirusTotal API key locally"
                  : "Cleared VirusTotal API key"
              );
            }}
            aria-label="VirusTotal API key"
            className="w-72 h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary"
          />
        </SettingRow>
      </SettingsCard>

      <SettingsCard title="HTTP Transport & Timeouts">
        <SettingRow
          title="HTTP Protocol Preference"
          description="Preferred transport version for compatible HTTPS servers"
        >
          <select
            aria-label="HTTP protocol version"
            value={draft.connection.httpVersion}
            onChange={(e) =>
              onUpdate((prev) => ({
                ...prev,
                connection: {
                  ...prev.connection,
                  httpVersion: e.target.value as "http1" | "auto" | "http3",
                },
              }))
            }
            className="h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface focus:outline-none focus:border-primary"
          >
            <option value="http1">HTTP/1.1</option>
            <option value="auto">Auto (H2/H1)</option>
            <option value="http3">HTTP/3 (QUIC)</option>
          </select>
        </SettingRow>

        <SettingRow
          title="Connect / Read Timeouts (Seconds)"
          description="Socket dial and body stall timeouts"
        >
          <input
            type="number"
            min={5}
            max={120}
            value={draft.connection.connectTimeoutSecs}
            onChange={(e) =>
              onUpdate((prev) => ({
                ...prev,
                connection: {
                  ...prev.connection,
                  connectTimeoutSecs: Math.max(5, Number(e.target.value) || 15),
                },
              }))
            }
            aria-label="Connect timeout seconds"
            className="w-16 h-8 px-2 rounded bg-surface border border-outline font-mono text-mono-sm tabular text-on-surface text-right"
          />
          <span className="font-mono text-mono-sm text-on-surface-variant">/</span>
          <input
            type="number"
            min={5}
            max={300}
            value={draft.connection.readTimeoutSecs}
            onChange={(e) =>
              onUpdate((prev) => ({
                ...prev,
                connection: {
                  ...prev.connection,
                  readTimeoutSecs: Math.max(5, Number(e.target.value) || 30),
                },
              }))
            }
            aria-label="Read timeout seconds"
            className="w-16 h-8 px-2 rounded bg-surface border border-outline font-mono text-mono-sm tabular text-on-surface text-right"
          />
        </SettingRow>

        <SettingRow
          title="Max Simultaneous Connections Per Host"
          description="0 uses each download's segment setting without per-domain throttling"
        >
          <input
            type="number"
            min={0}
            max={64}
            value={draft.connection.maxConnectionsPerHost}
            onChange={(e) =>
              onUpdate((prev) => ({
                ...prev,
                connection: {
                  ...prev.connection,
                  maxConnectionsPerHost: Math.max(0, Number(e.target.value) || 0),
                },
              }))
            }
            aria-label="Max connections per host"
            className="w-20 h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm tabular text-on-surface text-right"
          />
        </SettingRow>

        <SettingRow
          title="Custom User-Agent"
          description="Leave empty to use HDM's default desktop User-Agent"
        >
          <input
            type="text"
            value={draft.connection.userAgent}
            placeholder="Default HDM User-Agent"
            onChange={(e) =>
              onUpdate((prev) => ({
                ...prev,
                connection: { ...prev.connection, userAgent: e.target.value },
              }))
            }
            aria-label="Custom User-Agent"
            className="w-72 h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary"
          />
        </SettingRow>
      </SettingsCard>

      <SettingsCard title="Proxy Configuration">
        <SettingRow title="Proxy Mode" description="Applies to HTTP downloads and yt-dlp">
          <select
            aria-label="Proxy mode"
            value={draft.proxy.mode}
            onChange={(e) =>
              onUpdate((prev) => ({
                ...prev,
                proxy: {
                  ...prev.proxy,
                  mode: e.target.value as "none" | "system" | "http" | "socks5",
                },
              }))
            }
            className="h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface"
          >
            <option value="system">System Proxy</option>
            <option value="none">Direct (None)</option>
            <option value="http">HTTP Proxy</option>
            <option value="socks5">SOCKS5 Proxy</option>
          </select>
        </SettingRow>

        {(draft.proxy.mode === "http" || draft.proxy.mode === "socks5") && (
          <>
            <SettingRow title="Proxy Server Address" description="host:port">
              <input
                type="text"
                value={draft.proxy.address}
                placeholder="127.0.0.1:8080"
                onChange={(e) =>
                  onUpdate((prev) => ({
                    ...prev,
                    proxy: { ...prev.proxy, address: e.target.value },
                  }))
                }
                aria-label="Proxy address"
                className="w-64 h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface"
              />
            </SettingRow>

            <SettingRow title="Proxy Credentials" description="Optional authentication">
              <input
                type="text"
                value={draft.proxy.username}
                placeholder="Username"
                onChange={(e) =>
                  onUpdate((prev) => ({
                    ...prev,
                    proxy: { ...prev.proxy, username: e.target.value },
                  }))
                }
                aria-label="Proxy username"
                className="w-32 h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface"
              />
              <input
                type="password"
                value={draft.proxy.password}
                placeholder="Password"
                onChange={(e) =>
                  onUpdate((prev) => ({
                    ...prev,
                    proxy: { ...prev.proxy, password: e.target.value },
                  }))
                }
                aria-label="Proxy password"
                className="w-32 h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface"
              />
            </SettingRow>
          </>
        )}

        <SettingRow
          title="Bypass Hosts"
          description="Comma-separated hostnames or suffixes"
        >
          <input
            type="text"
            value={draft.proxy.bypass.join(", ")}
            placeholder="localhost, 127.0.0.1"
            onChange={(e) =>
              onUpdate((prev) => ({
                ...prev,
                proxy: {
                  ...prev.proxy,
                  bypass: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                },
              }))
            }
            aria-label="Proxy bypass hosts"
            className="w-72 h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface placeholder:text-on-surface-variant"
          />
        </SettingRow>
      </SettingsCard>
    </div>
  );
}
