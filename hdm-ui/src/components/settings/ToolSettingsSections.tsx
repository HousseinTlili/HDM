import { useEffect, useState } from "react";
import {
  Eye,
  EyeOff,
  FolderOpen,
  RefreshCw,
  Wrench,
} from "lucide-react";
import { pickFile, pickFolder } from "../../lib/dialog";
import { formatBytes } from "../../lib/format";
import { ipc } from "../../lib/ipc";
import type {
  HfContext,
  IntegrationStatus,
  Settings,
  ToolInfo,
  ToolStatus,
} from "../../lib/types";
import { useDownloadsStore } from "../../store/downloadsStore";
import { useUiStore } from "../../store/uiStore";
import { SettingRow, SettingsCard, ToggleSwitch } from "./SettingControls";

interface DraftProps {
  draft: Settings;
  onUpdate: (updater: (prev: Settings) => Settings) => void;
}

function ToolBadge({ info }: { info?: ToolInfo }) {
  const source = info?.source ?? "missing";
  const ok = source !== "missing";
  return (
    <span
      title={info?.path ?? info?.message ?? undefined}
      className={`font-mono text-mono-sm px-2 py-0.5 rounded-sm border ${
        ok
          ? "bg-status-connected-tint border-status-connected/30 text-status-connected"
          : "bg-status-warning-tint border-status-warning/30 text-status-warning"
      }`}
    >
      {ok ? `${source}${info?.version ? ` • ${info.version}` : ""}` : "missing"}
    </span>
  );
}

export function MediaSection({ draft, onUpdate }: DraftProps) {
  const pushToast = useUiStore((s) => s.pushToast);
  const toolsProgress = useDownloadsStore((s) => s.toolsProgress);
  const clearToolsProgress = useDownloadsStore((s) => s.clearToolsProgress);

  const [tools, setTools] = useState<ToolStatus | null>(null);
  const [busyTools, setBusyTools] = useState(false);

  const refreshTools = async () => {
    try {
      const s = await ipc.toolStatus();
      setTools(s);
    } catch {
      /* ignore preview failures */
    }
  };

  useEffect(() => {
    void refreshTools();
  }, []);

  const handleEnsureTools = async () => {
    setBusyTools(true);
    try {
      const s = await ipc.ensureTools();
      setTools(s);
      pushToast("success", "Media tools verified / installed");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      clearToolsProgress();
      setBusyTools(false);
    }
  };

  const handleUpdateYtdlp = async () => {
    setBusyTools(true);
    try {
      await ipc.updateYtdlp();
      await refreshTools();
      pushToast("success", "yt-dlp is up to date");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyTools(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard title="Managed Binaries">
        <SettingRow
          title="yt-dlp / ffmpeg / deno Status"
          description="Used to probe 1,800+ sites, mux 4K adaptive streams, and extract audio"
        >
          <button
            type="button"
            disabled={busyTools}
            onClick={() => void handleEnsureTools()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-surface-container-high border border-outline font-label text-label-sm text-on-surface hover:border-primary/40 disabled:opacity-50"
          >
            <Wrench size={13} aria-hidden="true" />
            <span>{busyTools ? "Working…" : "Verify / Install"}</span>
          </button>
          <button
            type="button"
            disabled={busyTools}
            onClick={() => void handleUpdateYtdlp()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-surface-container-high border border-outline font-label text-label-sm text-on-surface hover:border-primary/40 disabled:opacity-50"
          >
            <RefreshCw size={13} aria-hidden="true" />
            <span>Update yt-dlp</span>
          </button>
        </SettingRow>

        <div className="p-4 grid grid-cols-2 gap-3 bg-surface">
          <div className="flex items-center justify-between px-3 py-2 rounded bg-surface-container border border-outline">
            <span className="font-mono text-mono-sm text-on-surface">yt-dlp</span>
            <ToolBadge info={tools?.ytDlp} />
          </div>
          <div className="flex items-center justify-between px-3 py-2 rounded bg-surface-container border border-outline">
            <span className="font-mono text-mono-sm text-on-surface">ffmpeg</span>
            <ToolBadge info={tools?.ffmpeg} />
          </div>
          <div className="flex items-center justify-between px-3 py-2 rounded bg-surface-container border border-outline">
            <span className="font-mono text-mono-sm text-on-surface">ffprobe</span>
            <ToolBadge info={tools?.ffprobe} />
          </div>
          <div className="flex items-center justify-between px-3 py-2 rounded bg-surface-container border border-outline">
            <span className="font-mono text-mono-sm text-on-surface">deno</span>
            <ToolBadge info={tools?.deno} />
          </div>
        </div>

        {toolsProgress && (
          <div className="px-4 py-2.5 flex items-center justify-between gap-3 bg-primary-tint">
            <span className="font-mono text-mono-sm text-on-primary-badge">
              Downloading {toolsProgress.tool}…
            </span>
            <span className="font-mono text-mono-sm tabular text-on-surface">
              {formatBytes(toolsProgress.downloaded)}
              {toolsProgress.total ? ` / ${formatBytes(toolsProgress.total)}` : ""}
            </span>
          </div>
        )}
      </SettingsCard>

      <SettingsCard title="Video & Audio Defaults">
        <SettingRow title="Preferred Resolution">
          <select
            aria-label="Preferred video height"
            value={draft.video.preferredHeight}
            onChange={(e) =>
              onUpdate((prev) => ({
                ...prev,
                video: {
                  ...prev.video,
                  preferredHeight: Number(e.target.value),
                },
              }))
            }
            className="h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface"
          >
            <option value={2160}>2160p (4K)</option>
            <option value={1440}>1440p</option>
            <option value={1080}>1080p</option>
            <option value={720}>720p</option>
            <option value={480}>480p</option>
          </select>
        </SettingRow>

        <SettingRow title="Default Video Container / Audio Format">
          <select
            aria-label="Default video container"
            value={draft.video.container}
            onChange={(e) =>
              onUpdate((prev) => ({
                ...prev,
                video: { ...prev.video, container: e.target.value },
              }))
            }
            className="h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface"
          >
            <option value="mp4">MP4</option>
            <option value="mkv">MKV</option>
            <option value="webm">WebM</option>
          </select>
          <select
            aria-label="Default audio format"
            value={draft.video.audioFormat}
            onChange={(e) =>
              onUpdate((prev) => ({
                ...prev,
                video: { ...prev.video, audioFormat: e.target.value },
              }))
            }
            className="h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface"
          >
            <option value="m4a">M4A</option>
            <option value="mp3">MP3</option>
            <option value="opus">Opus</option>
            <option value="flac">FLAC</option>
            <option value="wav">WAV</option>
          </select>
        </SettingRow>

        <SettingRow title="SponsorBlock Mode">
          <select
            aria-label="SponsorBlock mode"
            value={draft.video.sponsorblock}
            onChange={(e) =>
              onUpdate((prev) => ({
                ...prev,
                video: {
                  ...prev.video,
                  sponsorblock: e.target.value as "off" | "mark" | "remove",
                },
              }))
            }
            className="h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface"
          >
            <option value="off">Off</option>
            <option value="mark">Mark Chapters</option>
            <option value="remove">Remove Segments</option>
          </select>
        </SettingRow>

        <SettingRow title="Browser Cookies For yt-dlp" description="Pass session cookies for member/age-gated sites">
          <select
            aria-label="Cookies from browser"
            value={draft.video.cookiesFromBrowser}
            onChange={(e) =>
              onUpdate((prev) => ({
                ...prev,
                video: { ...prev.video, cookiesFromBrowser: e.target.value },
              }))
            }
            className="h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface"
          >
            <option value="">None</option>
            <option value="chrome">Chrome</option>
            <option value="edge">Edge</option>
            <option value="firefox">Firefox</option>
            <option value="brave">Brave</option>
          </select>
        </SettingRow>

        <SettingRow title="Embed Metadata / Thumbnail / Chapters">
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-1.5 font-label text-label-sm text-on-surface cursor-pointer">
              <input
                type="checkbox"
                checked={draft.video.embedMetadata}
                onChange={(e) =>
                  onUpdate((prev) => ({
                    ...prev,
                    video: { ...prev.video, embedMetadata: e.target.checked },
                  }))
                }
                className="accent-[#E11D2E]"
              />
              <span>Meta</span>
            </label>
            <label className="inline-flex items-center gap-1.5 font-label text-label-sm text-on-surface cursor-pointer">
              <input
                type="checkbox"
                checked={draft.video.embedThumbnail}
                onChange={(e) =>
                  onUpdate((prev) => ({
                    ...prev,
                    video: { ...prev.video, embedThumbnail: e.target.checked },
                  }))
                }
                className="accent-[#E11D2E]"
              />
              <span>Cover</span>
            </label>
            <label className="inline-flex items-center gap-1.5 font-label text-label-sm text-on-surface cursor-pointer">
              <input
                type="checkbox"
                checked={draft.video.embedChapters}
                onChange={(e) =>
                  onUpdate((prev) => ({
                    ...prev,
                    video: { ...prev.video, embedChapters: e.target.checked },
                  }))
                }
                className="accent-[#E11D2E]"
              />
              <span>Chapters</span>
            </label>
          </div>
        </SettingRow>

        <SettingRow title="Embed Subtitles">
          <input
            type="text"
            value={draft.video.subtitleLangs}
            onChange={(e) =>
              onUpdate((prev) => ({
                ...prev,
                video: { ...prev.video, subtitleLangs: e.target.value },
              }))
            }
            placeholder="en.*"
            aria-label="Subtitle language pattern"
            className="w-24 h-8 px-2 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface"
          />
          <ToggleSwitch
            checked={draft.video.embedSubtitles}
            onChange={(checked) =>
              onUpdate((prev) => ({
                ...prev,
                video: { ...prev.video, embedSubtitles: checked },
              }))
            }
            label="Embed subtitles"
          />
        </SettingRow>

        <SettingRow title="Multi-Connection Acceleration & Auto-Update">
          <div className="flex items-center gap-4">
            <label className="inline-flex items-center gap-1.5 font-label text-label-sm text-on-surface cursor-pointer">
              <input
                type="checkbox"
                checked={draft.video.accelerate}
                onChange={(e) =>
                  onUpdate((prev) => ({
                    ...prev,
                    video: { ...prev.video, accelerate: e.target.checked },
                  }))
                }
                className="accent-[#E11D2E]"
              />
              <span>Accelerate HTTP</span>
            </label>
            <label className="inline-flex items-center gap-1.5 font-label text-label-sm text-on-surface cursor-pointer">
              <input
                type="checkbox"
                checked={draft.video.autoUpdate}
                onChange={(e) =>
                  onUpdate((prev) => ({
                    ...prev,
                    video: { ...prev.video, autoUpdate: e.target.checked },
                  }))
                }
                className="accent-[#E11D2E]"
              />
              <span>Auto-update yt-dlp</span>
            </label>
          </div>
        </SettingRow>

        <SettingRow title="Custom Binary Overrides" description="Optional custom paths to yt-dlp and ffmpeg">
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={draft.video.ytdlpPath}
              placeholder="Auto yt-dlp"
              onChange={(e) =>
                onUpdate((prev) => ({
                  ...prev,
                  video: { ...prev.video, ytdlpPath: e.target.value },
                }))
              }
              aria-label="Custom yt-dlp path"
              className="w-36 h-8 px-2 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface placeholder:text-on-surface-variant"
            />
            <button
              type="button"
              onClick={() => {
                void pickFile().then((p) => {
                  if (p) {
                    onUpdate((prev) => ({
                      ...prev,
                      video: { ...prev.video, ytdlpPath: p },
                    }));
                  }
                });
              }}
              aria-label="Browse yt-dlp executable"
              className="w-8 h-8 inline-flex items-center justify-center rounded bg-surface-container-high border border-outline text-on-surface-variant hover:text-on-surface"
            >
              <FolderOpen size={13} aria-hidden="true" />
            </button>
            <input
              type="text"
              value={draft.video.ffmpegPath}
              placeholder="Auto ffmpeg"
              onChange={(e) =>
                onUpdate((prev) => ({
                  ...prev,
                  video: { ...prev.video, ffmpegPath: e.target.value },
                }))
              }
              aria-label="Custom ffmpeg path"
              className="w-36 h-8 px-2 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface placeholder:text-on-surface-variant"
            />
            <button
              type="button"
              onClick={() => {
                void pickFile().then((p) => {
                  if (p) {
                    onUpdate((prev) => ({
                      ...prev,
                      video: { ...prev.video, ffmpegPath: p },
                    }));
                  }
                });
              }}
              aria-label="Browse ffmpeg executable"
              className="w-8 h-8 inline-flex items-center justify-center rounded bg-surface-container-high border border-outline text-on-surface-variant hover:text-on-surface"
            >
              <FolderOpen size={13} aria-hidden="true" />
            </button>
          </div>
        </SettingRow>
      </SettingsCard>
    </div>
  );
}

export function HuggingFaceSection({ draft, onUpdate }: DraftProps) {
  const [ctx, setCtx] = useState<HfContext | null>(null);
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    void ipc
      .hfContext()
      .then((c) => setCtx(c))
      .catch(() => {});
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard title="Hugging Face Hub">
        <SettingRow
          title="Hub Endpoint"
          description="Use huggingface.co or an HF mirror such as hf-mirror.com"
        >
          <input
            type="text"
            value={draft.huggingFace.endpoint}
            placeholder="https://huggingface.co"
            onChange={(e) =>
              onUpdate((prev) => ({
                ...prev,
                huggingFace: { ...prev.huggingFace, endpoint: e.target.value },
              }))
            }
            aria-label="Hugging Face endpoint"
            className="w-64 h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={() =>
              onUpdate((prev) => ({
                ...prev,
                huggingFace: {
                  ...prev.huggingFace,
                  endpoint: "https://hf-mirror.com",
                },
              }))
            }
            className="h-8 px-2.5 rounded bg-surface-container-high border border-outline font-mono text-mono-sm text-on-surface hover:border-primary/40"
          >
            Mirror
          </button>
        </SettingRow>

        <SettingRow
          title="Access Token (Gated & Private Repos)"
          description={
            ctx?.token
              ? `Active token detected from: ${ctx.token}`
              : "Leave blank to fall back to HF_TOKEN env or huggingface-cli login"
          }
        >
          <div className="flex items-center gap-1.5">
            <input
              type={showToken ? "text" : "password"}
              value={draft.huggingFace.token}
              placeholder="hf_..."
              onChange={(e) =>
                onUpdate((prev) => ({
                  ...prev,
                  huggingFace: { ...prev.huggingFace, token: e.target.value },
                }))
              }
              aria-label="Hugging Face access token"
              className="w-60 h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              aria-label={showToken ? "Hide token" : "Reveal token"}
              className="w-8 h-8 inline-flex items-center justify-center rounded bg-surface-container-high border border-outline text-on-surface-variant hover:text-on-surface"
            >
              {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </SettingRow>

        <SettingRow
          title="Default Models Folder"
          description="Target root folder for GGUF weights and repo snapshots"
        >
          <input
            type="text"
            value={draft.huggingFace.folder}
            placeholder={ctx?.folder || "(Downloads/Models)"}
            onChange={(e) =>
              onUpdate((prev) => ({
                ...prev,
                huggingFace: { ...prev.huggingFace, folder: e.target.value },
              }))
            }
            aria-label="Hugging Face default folder"
            className="w-64 h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface placeholder:text-on-surface-variant"
          />
          <button
            type="button"
            onClick={() => {
              void pickFolder(
                draft.huggingFace.folder || ctx?.folder || draft.downloads.defaultDir
              ).then((picked) => {
                if (picked) {
                  onUpdate((prev) => ({
                    ...prev,
                    huggingFace: { ...prev.huggingFace, folder: picked },
                  }));
                }
              });
            }}
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded bg-surface-container-high border border-outline font-label text-label-sm text-on-surface hover:border-primary/40"
          >
            <FolderOpen size={13} aria-hidden="true" />
            <span>Browse</span>
          </button>
          {ctx?.lmStudio && (
            <button
              type="button"
              onClick={() =>
                onUpdate((prev) => ({
                  ...prev,
                  huggingFace: { ...prev.huggingFace, folder: ctx.lmStudio ?? "" },
                }))
              }
              className="h-8 px-2.5 rounded bg-primary-tint border border-primary/40 font-label text-label-sm text-on-primary-badge"
            >
              LM Studio
            </button>
          )}
        </SettingRow>
      </SettingsCard>
    </div>
  );
}

export function BrowserSection({ draft, onUpdate }: DraftProps) {
  const pushToast = useUiStore((s) => s.pushToast);
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [repairing, setRepairing] = useState(false);

  useEffect(() => {
    void ipc
      .integrationStatus()
      .then((s) => setStatus(s))
      .catch(() => {});
  }, []);

  const handleRepair = async () => {
    setRepairing(true);
    try {
      const updated = await ipc.repairIntegration();
      setStatus(updated);
      pushToast("success", "Native messaging hosts repaired");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setRepairing(false);
    }
  };

  const handleOpenExtFolder = async (firefox: boolean) => {
    try {
      const folder = await ipc.extensionFolder(firefox);
      if (!folder) {
        pushToast("error", "Extension folder not found in this build");
        return;
      }
      await ipc.openPath(folder);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard title="Browser Extension & Native Host">
        <SettingRow
          title="Extension Bridge Status"
          description={
            status?.extensionConnected
              ? `Connected${status.extensionVersion ? ` (v${status.extensionVersion})` : ""}`
              : "Waiting for browser extension handshake (dev.prism.host)"
          }
        >
          <span
            className={`font-mono text-mono-sm px-2.5 py-1 rounded-sm border ${
              status?.extensionConnected
                ? "bg-status-connected-tint border-status-connected/30 text-status-connected"
                : "bg-surface border-outline text-on-surface-variant"
            }`}
          >
            {status?.extensionConnected ? "Connected" : "Idle"}
          </span>
        </SettingRow>

        <SettingRow
          title="Native Messaging Host Registration"
          description={status?.hostPath || "prism-native-host binary registration"}
        >
          <button
            type="button"
            disabled={repairing}
            onClick={() => void handleRepair()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-surface-container-high border border-outline font-label text-label-sm text-on-surface hover:border-primary/40 disabled:opacity-50"
          >
            <Wrench size={13} aria-hidden="true" />
            <span>{repairing ? "Repairing…" : "Repair Integration"}</span>
          </button>
        </SettingRow>

        <SettingRow
          title="Unpacked Extension Bundles"
          description="Open local Chromium or Firefox unpacked extension folder to load in browser"
        >
          <button
            type="button"
            onClick={() => void handleOpenExtFolder(false)}
            className="h-8 px-3 rounded bg-surface-container-high border border-outline font-label text-label-sm text-on-surface hover:border-primary/40"
          >
            Chromium Folder
          </button>
          <button
            type="button"
            onClick={() => void handleOpenExtFolder(true)}
            className="h-8 px-3 rounded bg-surface-container-high border border-outline font-label text-label-sm text-on-surface hover:border-primary/40"
          >
            Firefox Folder
          </button>
        </SettingRow>

        {status?.browsers && status.browsers.length > 0 && (
          <div className="p-4 flex flex-col gap-2 bg-surface">
            <span className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
              Detected Browsers
            </span>
            <div className="grid grid-cols-2 gap-2">
              {status.browsers.map((b) => (
                <div
                  key={b.browser}
                  className="px-3 py-2 rounded bg-surface-container border border-outline flex items-center justify-between gap-2"
                >
                  <span className="font-label text-label-sm text-on-surface truncate">
                    {b.name || b.browser}
                  </span>
                  <span
                    className={`font-mono text-mono-sm ${
                      b.registered && b.pointsToThisHost
                        ? "text-status-connected"
                        : b.installed
                        ? "text-status-warning"
                        : "text-on-surface-variant"
                    }`}
                  >
                    {b.registered && b.pointsToThisHost
                      ? "OK"
                      : b.installed
                      ? "Needs Repair"
                      : "Not Installed"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </SettingsCard>

      <SettingsCard title="Download Capture Rules">
        <SettingRow
          title="Intercept Browser Downloads"
          description="Capture matching downloads from Chromium and Firefox extensions"
        >
          <ToggleSwitch
            checked={draft.capture.enabled}
            onChange={(checked) =>
              onUpdate((prev) => ({
                ...prev,
                capture: { ...prev.capture, enabled: checked },
              }))
            }
            label="Intercept browser downloads"
          />
        </SettingRow>

        <SettingRow
          title="In-Page Video Download Button"
          description="Show floating HDM media capture button on supported video players"
        >
          <ToggleSwitch
            checked={draft.capture.videoButton}
            onChange={(checked) =>
              onUpdate((prev) => ({
                ...prev,
                capture: { ...prev.capture, videoButton: checked },
              }))
            }
            label="In-page video button"
          />
        </SettingRow>

        <SettingRow
          title="Minimum Intercept Size (KB) & Bypass Modifier"
          description="Ignore smaller files unless 0; hold key to download directly in browser"
        >
          <input
            type="number"
            min={0}
            value={draft.capture.minSizeKb}
            onChange={(e) =>
              onUpdate((prev) => ({
                ...prev,
                capture: {
                  ...prev.capture,
                  minSizeKb: Math.max(0, Number(e.target.value) || 0),
                },
              }))
            }
            aria-label="Minimum capture size KB"
            className="w-20 h-8 px-2 rounded bg-surface border border-outline font-mono text-mono-sm tabular text-on-surface text-right"
          />
          <select
            aria-label="Bypass modifier key"
            value={draft.capture.bypassKey}
            onChange={(e) =>
              onUpdate((prev) => ({
                ...prev,
                capture: {
                  ...prev.capture,
                  bypassKey: e.target.value as "alt" | "ctrl" | "shift" | "none",
                },
              }))
            }
            className="h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface"
          >
            <option value="alt">Alt</option>
            <option value="ctrl">Ctrl</option>
            <option value="shift">Shift</option>
            <option value="none">None</option>
          </select>
        </SettingRow>
      </SettingsCard>
    </div>
  );
}
