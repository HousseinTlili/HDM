import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import {
  ArrowDownToLine,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cpu,
  FolderArchive,
  Gauge,
  Globe,
  HardDrive,
  MonitorPlay,
  Play,
  RefreshCw,
  Share2,
  Square,
  Terminal,
} from "lucide-react";
import { computeSidebarCounts, formatBytes, formatSpeed } from "../../lib/format";
import { ipc } from "../../lib/ipc";
import type { SidebarFilter, SpeedTestResult } from "../../lib/types";
import { useDownloadsStore } from "../../store/downloadsStore";
import { useUiStore } from "../../store/uiStore";

interface NavItem {
  id: SidebarFilter;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  dividerAfter?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: "all", label: "All Downloads", icon: FolderArchive },
  { id: "active", label: "Active", icon: ArrowDownToLine },
  { id: "completed", label: "Completed", icon: CheckCircle2 },
  { id: "queued", label: "Queued", icon: Clock, dividerAfter: true },
  { id: "video", label: "Video (yt-dlp)", icon: MonitorPlay },
  { id: "torrent", label: "Torrents", icon: Share2 },
  { id: "ai", label: "AI Models (GGUF)", icon: Cpu },
];

export function Sidebar() {
  const itemsById = useDownloadsStore((s) => s.itemsById);
  const itemOrder = useDownloadsStore((s) => s.itemOrder);
  const queues = useDownloadsStore((s) => s.queues);
  const globalSpeedHistory = useDownloadsStore((s) => s.globalSpeedHistory);
  const currentDownloadSpeed = useDownloadsStore((s) => s.currentDownloadSpeed);
  const speedLimiterEnabled = useDownloadsStore(
    (s) => s.settings?.downloads.speedLimiterEnabled ?? false
  );

  const activeFilter = useUiStore((s) => s.activeFilter);
  const activeView = useUiStore((s) => s.activeView);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const setActiveFilter = useUiStore((s) => s.setActiveFilter);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const setSettingsSection = useUiStore((s) => s.setSettingsSection);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const pushToast = useUiStore((s) => s.pushToast);

  const [extConnected, setExtConnected] = useState(false);
  const [speedTesting, setSpeedTesting] = useState(false);
  const [speedResult, setSpeedResult] = useState<SpeedTestResult | null>(null);

  const handleRunSpeedTest = async () => {
    if (speedTesting) return;
    setSpeedTesting(true);
    try {
      const res = await ipc.runSpeedTest();
      setSpeedResult(res);
      const mbps = ((res.downloadBps * 8) / 1_000_000).toFixed(1);
      pushToast("success", `Speed test: ${formatSpeed(res.downloadBps)} (${mbps} Mbps) • ${res.latencyMs} ms`);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Speed test failed");
    } finally {
      setSpeedTesting(false);
    }
  };

  useEffect(() => {
    let alive = true;
    const check = () => {
      void ipc
        .integrationStatus()
        .then((s) => {
          if (alive) setExtConnected(Boolean(s.extensionConnected));
        })
        .catch(() => {});
    };
    check();
    const timer = window.setInterval(check, 15_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const { counts, savedBytes, pausedCount } = useMemo(() => {
    const items = itemOrder.map((id) => itemsById[id]).filter(Boolean);
    let saved = 0;
    let paused = 0;
    for (const item of items) {
      if (item.trashed) continue;
      if (item.status === "completed") {
        saved += item.size ?? item.downloaded;
      } else if (item.status === "paused" || item.status === "failed") {
        paused += 1;
      }
    }
    return {
      counts: computeSidebarCounts(items),
      savedBytes: saved,
      pausedCount: paused,
    };
  }, [itemsById, itemOrder]);

  const sparklinePoints = useMemo(() => {
    const width = 180;
    const height = 34;
    const padY = 4;
    const maxSpeed = Math.max(...globalSpeedHistory, 1024);
    const len = globalSpeedHistory.length;
    if (len <= 1) return `0,${height - padY} ${width},${height - padY}`;
    return globalSpeedHistory
      .map((spd, idx) => {
        const x = (idx / (len - 1)) * width;
        const ratio = Math.min(1, Math.max(0, spd / maxSpeed));
        const y = height - padY - ratio * (height - padY * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [globalSpeedHistory]);

  const toggleQueue = async (id: string, running: boolean) => {
    try {
      if (running) await ipc.stopQueue(id);
      else await ipc.startQueue(id);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <aside
      className={`${
        collapsed ? "w-[56px]" : "w-[220px]"
      } shrink-0 bg-surface-container flex flex-col justify-between min-h-0 select-none transition-[width] duration-panel-slide ease-panel-slide`}
    >
      {/* Top Categories + Queues + Session Overview */}
      <div className="p-2 flex flex-col gap-3 min-h-0 overflow-y-auto">
        <div
          className={`flex items-center ${
            collapsed ? "justify-center" : "justify-between px-2"
          } pt-1`}
        >
          {!collapsed && (
            <span className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
              Categories
            </span>
          )}
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="inline-flex items-center justify-center w-6 h-6 rounded-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors duration-state-change ease-state-change"
          >
            {collapsed ? (
              <ChevronRight size={15} aria-hidden="true" />
            ) : (
              <ChevronLeft size={15} aria-hidden="true" />
            )}
          </button>
        </div>

        <nav aria-label="Download categories" className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((entry) => {
            const Icon = entry.icon;
            const isSelected =
              activeView === "downloads" && activeFilter === entry.id;
            const count = counts[entry.id];

            return (
              <div key={entry.id}>
                <button
                  type="button"
                  onClick={() => setActiveFilter(entry.id)}
                  aria-current={isSelected ? "page" : undefined}
                  title={collapsed ? `${entry.label} (${count})` : undefined}
                  className={`group flex items-center ${
                    collapsed ? "justify-center px-0" : "justify-between px-2.5"
                  } w-full py-1.5 rounded text-left transition-colors duration-state-change ease-state-change ${
                    isSelected
                      ? "bg-primary-tint border-l-2 border-l-primary text-on-surface"
                      : "border-l-2 border-l-transparent text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Icon
                      size={15}
                      className={
                        isSelected
                          ? "text-on-primary-badge shrink-0"
                          : entry.id === "active" && count > 0
                          ? "text-on-primary-badge shrink-0"
                          : entry.id === "completed" && count > 0
                          ? "text-status-connected/80 shrink-0"
                          : "shrink-0"
                      }
                    />
                    {!collapsed && (
                      <span className="font-label text-label-md truncate">
                        {entry.label}
                      </span>
                    )}
                  </span>

                  {!collapsed && (
                    <span
                      className={`font-mono text-mono-sm tabular ${
                        isSelected
                          ? "text-on-primary-badge px-1.5 py-0.5 rounded-sm bg-primary-badge"
                          : "text-on-surface-variant"
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
                {entry.dividerAfter && (
                  <div
                    className="my-1.5 border-t border-outline-subtle"
                    aria-hidden="true"
                  />
                )}
              </div>
            );
          })}
        </nav>

        {/* AI Model Hub (Ollama + Hugging Face) */}
        <div className="pt-0.5 flex flex-col gap-1">
          {!collapsed && (
            <span className="px-2 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
              Model Discovery
            </span>
          )}
          <button
            type="button"
            onClick={() => setActiveView("models")}
            aria-current={activeView === "models" ? "page" : undefined}
            title={collapsed ? "AI Model Hub (Ollama & Hugging Face)" : undefined}
            className={`group flex items-center ${
              collapsed ? "justify-center px-0" : "justify-between px-2.5"
            } w-full py-1.5 rounded text-left transition-colors duration-state-change ease-state-change ${
              activeView === "models"
                ? "bg-primary-tint border-l-2 border-l-primary text-on-surface"
                : "border-l-2 border-l-transparent text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
            }`}
          >
            <span className="flex items-center gap-2 min-w-0">
              <Terminal
                size={15}
                className={
                  activeView === "models"
                    ? "text-on-primary-badge shrink-0"
                    : "text-on-primary-badge/80 shrink-0"
                }
                aria-hidden="true"
              />
              {!collapsed && (
                <span className="font-label text-label-md truncate">
                  AI Model Hub
                </span>
              )}
            </span>
            {!collapsed && (
              <span className="font-mono text-mono-sm px-1.5 py-0.5 rounded-sm bg-primary-badge text-on-primary-badge">
                Ollama/HF
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveView("scheduler")}
            aria-current={activeView === "scheduler" ? "page" : undefined}
            title={collapsed ? "Queues & Scheduler" : undefined}
            className={`group flex items-center ${
              collapsed ? "justify-center px-0" : "justify-between px-2.5"
            } w-full py-1.5 rounded text-left transition-colors duration-state-change ease-state-change ${
              activeView === "scheduler"
                ? "bg-primary-tint border-l-2 border-l-primary text-on-surface"
                : "border-l-2 border-l-transparent text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
            }`}
          >
            <span className="flex items-center gap-2 min-w-0">
              <CalendarClock
                size={15}
                className={
                  activeView === "scheduler"
                    ? "text-on-primary-badge shrink-0"
                    : "shrink-0"
                }
                aria-hidden="true"
              />
              {!collapsed && (
                <span className="font-label text-label-md truncate">
                  Scheduler
                </span>
              )}
            </span>
            {!collapsed && (
              <span className="font-mono text-mono-sm text-on-surface-variant">
                {queues.filter((q) => q.schedule.enabled).length} on
              </span>
            )}
          </button>
        </div>

        {/* Queues & Session Stats (when expanded) */}
        {!collapsed && (
          <>
            {queues.length > 0 && (
              <div className="pt-1 flex flex-col gap-1.5">
                <span className="px-2 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
                  Queues
                </span>
                <div className="flex flex-col gap-1">
                  {queues.slice(0, 3).map((q) => (
                    <div
                      key={q.id}
                      className="px-2.5 py-1.5 rounded bg-surface border border-outline flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            q.running ? "bg-primary" : "bg-on-surface-variant/40"
                          }`}
                          aria-hidden="true"
                        />
                        <span className="font-label text-label-sm text-on-surface truncate">
                          {q.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="font-mono text-mono-sm tabular text-on-surface-variant">
                          {q.maxConcurrent}x
                        </span>
                        <button
                          type="button"
                          onClick={() => void toggleQueue(q.id, q.running)}
                          aria-label={q.running ? `Stop ${q.name}` : `Start ${q.name}`}
                          title={q.running ? "Stop queue" : "Start queue"}
                          className="inline-flex items-center justify-center w-5 h-5 rounded-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
                        >
                          {q.running ? (
                            <Square size={10} aria-hidden="true" />
                          ) : (
                            <Play size={10} aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-1 flex flex-col gap-1.5">
              <span className="px-2 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
                Session
              </span>
              <div className="rounded-md bg-surface border border-outline p-2.5 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 font-label text-label-sm text-on-surface-variant">
                    <HardDrive size={12} aria-hidden="true" />
                    <span>Total Saved</span>
                  </span>
                  <span className="font-mono text-mono-sm tabular text-on-surface">
                    {formatBytes(savedBytes)}
                  </span>
                </div>

                {pausedCount > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="font-label text-label-sm text-on-surface-variant">
                      Paused / Attention
                    </span>
                    <span className="font-mono text-mono-sm tabular text-status-warning">
                      {pausedCount}
                    </span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setSettingsSection("browser");
                    setActiveView("settings");
                  }}
                  className="flex items-center justify-between pt-1.5 border-t border-outline-subtle text-left hover:text-on-surface transition-colors duration-state-change"
                >
                  <span className="inline-flex items-center gap-1.5 font-label text-label-sm text-on-surface-variant">
                    <Globe size={12} aria-hidden="true" />
                    <span>Extension</span>
                  </span>
                  <span
                    className={`font-mono text-mono-sm ${
                      extConnected ? "text-status-connected" : "text-on-surface-variant"
                    }`}
                  >
                    {extConnected ? "Connected" : "Standby"}
                  </span>
                </button>
              </div>
            </div>

            {/* Internet Speed Test */}
            <div className="pt-1 flex flex-col gap-1.5">
              <div className="rounded-md bg-surface border border-outline p-2.5 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 font-label text-label-sm text-on-surface">
                    <Gauge size={13} className="text-on-primary-badge" aria-hidden="true" />
                    <span>Speed Test</span>
                  </span>
                  <button
                    type="button"
                    disabled={speedTesting}
                    onClick={() => void handleRunSpeedTest()}
                    className="inline-flex items-center gap-1 h-6 px-2 rounded-sm bg-surface-container-high border border-outline font-label text-label-sm text-on-surface hover:border-primary/50 disabled:opacity-50 transition-colors duration-state-change"
                  >
                    <RefreshCw
                      size={11}
                      className={speedTesting ? "animate-spin" : ""}
                      aria-hidden="true"
                    />
                    <span>{speedTesting ? "Testing" : speedResult ? "Retest" : "Run"}</span>
                  </button>
                </div>

                {speedResult ? (
                  <div className="flex items-center justify-between text-on-surface-variant">
                    <span className="font-mono text-mono-sm tabular text-on-surface">
                      ↓ {formatSpeed(speedResult.downloadBps)}
                    </span>
                    <span className="font-mono text-mono-sm tabular">
                      {((speedResult.downloadBps * 8) / 1_000_000).toFixed(0)} Mbps • {speedResult.latencyMs}ms
                    </span>
                  </div>
                ) : (
                  <span className="font-body text-body-sm text-on-surface-variant">
                    {speedTesting ? "Measuring Cloudflare throughput…" : "Measure live DL throughput & ping"}
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer: Net I/O Sparkline + Engine Status Pill */}
      <div className="p-2.5 border-t border-outline flex flex-col gap-2.5 shrink-0">
        {!collapsed && (
          <div className="rounded-md bg-surface border border-outline p-2.5 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
                Net I/O
              </span>
              <span className="font-mono text-mono-sm tabular text-on-surface">
                {formatSpeed(currentDownloadSpeed)}
              </span>
            </div>
            <svg
              viewBox="0 0 180 34"
              className="w-full h-8 overflow-visible"
              aria-label="Real-time network download speed sparkline"
            >
              <polyline
                fill="none"
                stroke="#24242C"
                strokeWidth="1"
                strokeDasharray="2 2"
                points="0,30 180,30"
              />
              <polyline
                fill="none"
                stroke="#E11D2E"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="crimson-stroke-glow"
                points={sparklinePoints}
              />
            </svg>
            <div className="flex items-center justify-between text-on-surface-variant">
              <span className="font-mono text-mono-sm tabular">
                ↓ {formatSpeed(currentDownloadSpeed)}
              </span>
              <span className="font-mono text-mono-sm">
                {speedLimiterEnabled ? "Capped" : "Unthrottled"}
              </span>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setActiveView("settings")}
          title="Engine Online — Open Settings"
          className={`flex items-center ${
            collapsed ? "justify-center px-0" : "justify-between px-2.5"
          } w-full py-1.5 rounded bg-status-connected-tint border border-status-connected/30 hover:border-status-connected/60 transition-colors duration-state-change ease-state-change`}
        >
          <span className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full bg-status-connected shrink-0"
              aria-hidden="true"
            />
            {!collapsed && (
              <span className="font-label text-label-sm text-status-connected">
                Engine Online
              </span>
            )}
          </span>
          {!collapsed && (
            <span className="font-mono text-mono-sm text-on-surface-variant">
              IPC
            </span>
          )}
        </button>
      </div>
    </aside>
  );
}
