import { useMemo, useState } from "react";
import type { ComponentType } from "react";
import {
  ArrowLeft,
  Cpu,
  FolderCog,
  Gauge,
  Globe,
  MonitorPlay,
  Network,
  RotateCcw,
  Save,
  Share2,
} from "lucide-react";
import { ipc } from "../../lib/ipc";
import type { Category, Settings, SettingsSection } from "../../lib/types";
import { useDownloadsStore } from "../../store/downloadsStore";
import { useUiStore } from "../../store/uiStore";
import {
  DirectoriesSection,
  EngineSection,
  NetworkSection,
  TorrentSection,
} from "./CoreSettingsSections";
import {
  BrowserSection,
  HuggingFaceSection,
  MediaSection,
} from "./ToolSettingsSections";

const SECTION_META: {
  id: SettingsSection;
  label: string;
  title: string;
  subtitle: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}[] = [
  {
    id: "engine",
    label: "Engine & Threads",
    title: "Engine & Connection Limits",
    subtitle:
      "Configure multi-segment concurrency (1-32 threads), global bandwidth caps, and startup behavior.",
    icon: Gauge,
  },
  {
    id: "directories",
    label: "Directories & Rules",
    title: "Directories & Storage Rules",
    subtitle:
      "Manage default download directories, category routing folders, and file conflict handling.",
    icon: FolderCog,
  },
  {
    id: "video",
    label: "yt-dlp & Media",
    title: "yt-dlp & Media Toolchain",
    subtitle:
      "Verify managed yt-dlp/ffmpeg/deno binaries and set default quality, container, and metadata options.",
    icon: MonitorPlay,
  },
  {
    id: "torrent",
    label: "BitTorrent",
    title: "BitTorrent Swarm Engine",
    subtitle:
      "Inspect librqbit discovery capabilities, persistence storage, and bandwidth policy.",
    icon: Share2,
  },
  {
    id: "huggingface",
    label: "Hugging Face Auth",
    title: "Hugging Face Hub & Models",
    subtitle:
      "Configure Hub mirror endpoints, gated access tokens, and default local GGUF folders.",
    icon: Cpu,
  },
  {
    id: "network",
    label: "Network & Proxy",
    title: "Network Transport & Proxy",
    subtitle:
      "Tune HTTP transport versions, socket timeouts, User-Agent, and proxy settings.",
    icon: Network,
  },
  {
    id: "browser",
    label: "Browser Integration",
    title: "Browser Extension & Capture",
    subtitle:
      "Manage Chromium/Firefox native messaging registration and download interception rules.",
    icon: Globe,
  },
];

export function SettingsView() {
  const settings = useDownloadsStore((s) => s.settings);
  const categories = useDownloadsStore((s) => s.categories);
  const queues = useDownloadsStore((s) => s.queues);
  const version = useDownloadsStore((s) => s.version);
  const dataDir = useDownloadsStore((s) => s.dataDir);

  if (!settings) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-on-surface-variant font-body text-body-sm">
        Loading engine settings…
      </div>
    );
  }

  return (
    <SettingsWorkspace
      initialSettings={settings}
      initialCategories={categories}
      mainQueue={queues.find((q) => q.id === "main") ?? queues[0]}
      version={version}
      dataDir={dataDir}
    />
  );
}

function SettingsWorkspace({
  initialSettings,
  initialCategories,
  mainQueue,
  version,
  dataDir,
}: {
  initialSettings: Settings;
  initialCategories: Category[];
  mainQueue?: ReturnType<typeof useDownloadsStore.getState>["queues"][number];
  version: string;
  dataDir: string;
}) {
  const section = useUiStore((s) => s.settingsSection);
  const setSection = useUiStore((s) => s.setSettingsSection);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const pushToast = useUiStore((s) => s.pushToast);

  const [baselineSettings, setBaselineSettings] = useState<Settings>(() =>
    structuredClone(initialSettings)
  );
  const [baselineCategories, setBaselineCategories] = useState<Category[]>(() =>
    structuredClone(initialCategories)
  );
  const [baselineMaxConcurrent, setBaselineMaxConcurrent] = useState<number>(
    mainQueue?.maxConcurrent ?? 4
  );

  const [draft, setDraft] = useState<Settings>(() =>
    structuredClone(initialSettings)
  );
  const [categoryDrafts, setCategoryDrafts] = useState<Category[]>(() =>
    structuredClone(initialCategories)
  );
  const [mainMaxConcurrent, setMainMaxConcurrent] = useState<number>(
    mainQueue?.maxConcurrent ?? 4
  );
  const [saving, setSaving] = useState(false);

  const isDirty = useMemo(() => {
    return (
      JSON.stringify(draft) !== JSON.stringify(baselineSettings) ||
      JSON.stringify(categoryDrafts) !== JSON.stringify(baselineCategories) ||
      mainMaxConcurrent !== baselineMaxConcurrent
    );
  }, [
    draft,
    baselineSettings,
    categoryDrafts,
    baselineCategories,
    mainMaxConcurrent,
    baselineMaxConcurrent,
  ]);

  const handleReset = () => {
    setDraft(structuredClone(baselineSettings));
    setCategoryDrafts(structuredClone(baselineCategories));
    setMainMaxConcurrent(baselineMaxConcurrent);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const savedSettings = await ipc.updateSettings(
        draft as unknown as Record<string, unknown>
      );

      if (
        draft.general.launchAtStartup !==
        baselineSettings.general.launchAtStartup
      ) {
        await ipc.setAutostart(draft.general.launchAtStartup).catch(() => {});
      }

      if (mainQueue && mainMaxConcurrent !== baselineMaxConcurrent) {
        await ipc.upsertQueue({
          ...mainQueue,
          maxConcurrent: mainMaxConcurrent,
        });
      }

      for (const cat of categoryDrafts) {
        const orig = baselineCategories.find((c) => c.id === cat.id);
        if (orig && (orig.saveDir ?? null) !== (cat.saveDir ?? null)) {
          await ipc.upsertCategory(cat);
        }
      }

      const nextSettings = structuredClone(savedSettings ?? draft);
      const nextCategories = structuredClone(categoryDrafts);
      setBaselineSettings(nextSettings);
      setDraft(structuredClone(nextSettings));
      setBaselineCategories(nextCategories);
      setBaselineMaxConcurrent(mainMaxConcurrent);

      pushToast("success", "Engine configuration saved");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const meta =
    SECTION_META.find((s) => s.id === section) ?? SECTION_META[0];

  return (
    <div className="flex-1 flex min-h-0">
      {/* Settings Inner Sidebar (220px) */}
      <aside className="w-[220px] shrink-0 bg-surface-container flex flex-col justify-between min-h-0 select-none">
        <div className="p-2 flex flex-col gap-3 min-h-0 overflow-y-auto">
          <div className="flex items-center justify-between px-2 pt-1">
            <span className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
              Settings
            </span>
            <button
              type="button"
              onClick={() => setActiveView("downloads")}
              className="inline-flex items-center gap-1 font-label text-label-sm text-on-surface-variant hover:text-on-surface"
            >
              <ArrowLeft size={13} aria-hidden="true" />
              <span>Queue</span>
            </button>
          </div>

          <nav aria-label="Settings sections" className="flex flex-col gap-0.5">
            {SECTION_META.map((item) => {
              const Icon = item.icon;
              const selected = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={selected ? "page" : undefined}
                  onClick={() => setSection(item.id)}
                  className={`flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-left transition-colors duration-state-change ease-state-change ${
                    selected
                      ? "bg-primary-tint border-l-2 border-l-primary text-on-surface"
                      : "border-l-2 border-l-transparent text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                  }`}
                >
                  <Icon
                    size={15}
                    className={selected ? "text-on-primary-badge shrink-0" : "shrink-0"}
                  />
                  <span className="font-label text-label-md truncate">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-3 border-t border-outline">
          <div className="flex items-center justify-between px-2.5 py-1.5 rounded bg-status-connected-tint border border-status-connected/30">
            <span className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full bg-status-connected"
                aria-hidden="true"
              />
              <span className="font-label text-label-sm text-status-connected">
                Engine Online
              </span>
            </span>
            <span className="font-mono text-mono-sm text-on-surface-variant">
              v{version}
            </span>
          </div>
        </div>
      </aside>

      {/* Main Scrollable Settings Content */}
      <div className="flex-1 bg-surface rounded-xl border border-outline/80 overflow-hidden mb-2 mr-2 flex flex-col min-w-0 min-h-0">
        <div className="px-6 py-4 border-b border-outline flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0 flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <h1 className="font-title text-title-lg text-on-surface truncate">
                {meta.title}
              </h1>
              {isDirty && (
                <span className="font-mono text-mono-sm px-1.5 py-0.5 rounded-sm bg-status-warning-tint border border-status-warning/30 text-status-warning">
                  Unsaved
                </span>
              )}
            </div>
            <p className="font-body text-body-sm text-on-surface-variant truncate">
              {meta.subtitle}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isDirty && (
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-surface-container border border-outline font-label text-label-md text-on-surface-variant hover:text-on-surface"
              >
                <RotateCcw size={13} aria-hidden="true" />
                <span>Reset</span>
              </button>
            )}
            <button
              type="button"
              disabled={saving || !isDirty}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-1.5 h-8 px-4 rounded bg-primary text-on-primary font-label text-label-md hover:bg-primary/90 disabled:opacity-40"
            >
              <Save size={14} aria-hidden="true" />
              <span>{saving ? "Saving…" : "Save Config"}</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto">
            {section === "engine" && (
              <EngineSection
                draft={draft}
                onUpdate={setDraft}
                mainMaxConcurrent={mainMaxConcurrent}
                onChangeMainMaxConcurrent={setMainMaxConcurrent}
              />
            )}
            {section === "directories" && (
              <DirectoriesSection
                draft={draft}
                onUpdate={setDraft}
                categoryDrafts={categoryDrafts}
                onChangeCategoryDir={(id, saveDir) =>
                  setCategoryDrafts((prev) =>
                    prev.map((c) => (c.id === id ? { ...c, saveDir } : c))
                  )
                }
                dataDir={dataDir}
              />
            )}
            {section === "video" && (
              <MediaSection draft={draft} onUpdate={setDraft} />
            )}
            {section === "torrent" && (
              <TorrentSection draft={draft} dataDir={dataDir} />
            )}
            {section === "huggingface" && (
              <HuggingFaceSection draft={draft} onUpdate={setDraft} />
            )}
            {section === "network" && (
              <NetworkSection draft={draft} onUpdate={setDraft} />
            )}
            {section === "browser" && (
              <BrowserSection draft={draft} onUpdate={setDraft} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
