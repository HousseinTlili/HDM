import { inTauri } from "./window";
import type {
  BatchInfo,
  Bootstrap,
  CaptureInfo,
  Category,
  CoreEvent,
  DownloadItem,
  GrabberConfig,
  GrabberProject,
  HdmConfirmCaptureArgs,
  HdmIntent,
  HfBrowseArgs,
  HfBrowseHit,
  HfContext,
  HfFile,
  HfHit,
  HfKind,
  HfPresent,
  HfRepo,
  IntegrationStatus,
  ItemDetails,
  ItemPatch,
  LocalGgufFile,
  OllamaDownloadArgs,
  OllamaDownloadResult,
  OllamaLocalStatus,
  OllamaManifestInfo,
  OllamaModelSummary,
  OllamaTagInfo,
  Queue,
  SecurityScanReport,
  Settings,
  Sha256Verification,
  SniffedStream,
  SpeedTestResult,
  StartMode,
  SystemHardwareInfo,
  ToolStatus,
  TorrentMeta,
  TorrentSource,
  VideoCapture,
  VideoDecision,
  VideoProbe,
  ZipFile,
} from "./types";

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!inTauri) {
    return mockInvoke<T>(cmd);
  }
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

export async function onCoreEvent(handler: (event: CoreEvent) => void): Promise<() => void> {
  if (!inTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<CoreEvent>("core", (e) => handler(e.payload));
}

export async function onHdmIntent(handler: (intent: HdmIntent) => void): Promise<() => void> {
  if (!inTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<HdmIntent>("hdm-intent", (e) => handler(e.payload));
}

export const ipc = {
  bootstrap: () => invoke<Bootstrap>("bootstrap"),
  mainWindowStartsVisible: () => invoke<boolean>("main_window_starts_visible"),
  drainUiIntents: () => invoke<HdmIntent[]>("drain_ui_intents"),
  integrationStatus: () => invoke<IntegrationStatus>("integration_status"),
  toggleSpeedLimiter: () => invoke<boolean>("toggle_speed_limiter"),
  startItems: (ids: string[]) => invoke<void>("start_items", { ids }),
  pauseItems: (ids: string[]) => invoke<void>("pause_items", { ids }),
  pauseAll: () => invoke<void>("pause_all"),
  resumeAll: () => invoke<void>("resume_all"),
  deleteItems: (ids: string[], deleteFiles: boolean, permanent = true) =>
    invoke<void>("delete_items", { ids, deleteFiles, permanent }),
  restoreItems: (ids: string[]) => invoke<void>("restore_items", { ids }),
  removeCompleted: () => invoke<void>("remove_completed"),
  clearMissingCompleted: () => invoke<number>("clear_missing_completed"),
  redownload: (id: string) => invoke<void>("redownload", { id }),
  updateItem: (id: string, patch: ItemPatch) => invoke<DownloadItem>("update_item", { id, patch }),
  itemDetails: (id: string) => invoke<ItemDetails | null>("item_details", { id }),
  openItem: (id: string) => invoke<void>("open_item", { id }),
  revealItem: (id: string) => invoke<void>("reveal_item", { id }),
  verifyItemSha256: (id: string) => invoke<Sha256Verification>("verify_item_sha256", { id }),
  clipboardRead: () => invoke<string>("clipboard_read"),
  clipboardWrite: (text: string) => invoke<void>("clipboard_write", { text }),
  addUrl: (args: {
    url: string;
    referer?: string;
    username?: string;
    password?: string;
    fileName?: string;
  }) => invoke<CaptureInfo>("add_url", { args }),
  getCapture: (id: string) => invoke<CaptureInfo | null>("get_capture", { id }),
  hdmConfirmCapture: (args: HdmConfirmCaptureArgs) =>
    invoke<DownloadItem>("hdm_confirm_capture", { args }),
  cancelCapture: (id: string) => invoke<void>("cancel_capture", { id }),
  reprobeCapture: (id: string, username?: string, password?: string) =>
    invoke<void>("reprobe_capture", { id, username, password }),
  zipContents: (id: string) => invoke<ZipFile[]>("zip_contents", { id }),
  extractZipFile: (id: string, index: number, dir: string) =>
    invoke<string>("extract_zip_file", { id, index, dir }),
  cancelZipFile: (id: string, index: number) =>
    invoke<void>("cancel_zip_file", { id, index }),

  batchFromPattern: (pattern: string) =>
    invoke<BatchInfo>("batch_from_pattern", { pattern }),
  batchFromText: (text: string) => invoke<BatchInfo>("batch_from_text", { text }),
  confirmBatch: (decision: {
    id: string;
    urls: string[];
    saveDir?: string;
    mode: StartMode;
  }) => invoke<number>("confirm_batch", { decision }),
  cancelBatch: (id: string) => invoke<void>("cancel_batch", { id }),

  getVideo: (id: string) => invoke<VideoCapture | null>("get_video", { id }),
  openVideoUrl: (url: string) => invoke<VideoCapture>("open_video_url", { url }),
  probeVideo: (url: string) => invoke<VideoProbe>("probe_video", { url }),
  confirmVideo: (decision: VideoDecision) =>
    invoke<number>("confirm_video", { decision }),
  cancelVideo: (id: string) => invoke<void>("cancel_video", { id }),
  addStream: (stream: SniffedStream, pageUrl?: string, title?: string) =>
    invoke<DownloadItem>("add_stream", { args: { stream, pageUrl, title } }),

  inspectTorrent: (source: TorrentSource) =>
    invoke<TorrentMeta>("inspect_torrent", { source }),
  readTorrentFile: (path: string) =>
    invoke<TorrentSource>("read_torrent_file", { path }),
  addTorrent: (args: {
    source: TorrentSource;
    name: string;
    size?: number;
    onlyFiles?: number[] | null;
    saveDir?: string;
    category?: string;
    mode?: StartMode;
  }) => invoke<DownloadItem>("add_torrent", { args }),
  recheckTorrent: (id: string) => invoke<void>("recheck_torrent", { id }),
  setTorrentOptions: (args: {
    id: string;
    sequential?: boolean;
    extraTrackers?: string[];
    maxDlBps?: number;
    maxUlBps?: number;
  }) => invoke<DownloadItem>("set_torrent_options", { args }),

  hfContext: () => invoke<HfContext>("hf_context"),
  hfRepo: (input: string) => invoke<HfRepo>("hf_repo", { input }),
  hfSearch: (query: string) => invoke<HfHit[]>("hf_search", { query }),
  hfBrowse: (args: HfBrowseArgs) => invoke<HfBrowseHit[]>("hf_browse", { args }),
  hfPresent: (args: {
    kind: HfKind;
    id: string;
    sha: string;
    folder: string;
    files: HfFile[];
  }) => invoke<HfPresent>("hf_present", { args }),
  hfAdd: (args: {
    kind: HfKind;
    id: string;
    sha: string;
    files: HfFile[];
    folder: string;
    mode: StartMode | null;
  }) => invoke<number>("hf_add", { args }),

  ollamaSearch: (query: string, category?: string) =>
    invoke<OllamaModelSummary[]>("ollama_search", { query, category }),
  ollamaModelTags: (model: string) =>
    invoke<OllamaTagInfo[]>("ollama_model_tags", { model }),
  ollamaInspectManifest: (model: string, tag: string) =>
    invoke<OllamaManifestInfo>("ollama_inspect_manifest", { model, tag }),
  ollamaLocalStatus: () => invoke<OllamaLocalStatus>("ollama_local_status"),
  ollamaDownload: (args: OllamaDownloadArgs) =>
    invoke<OllamaDownloadResult>("ollama_download", { args }),
  ollamaImportGguf: (modelRef: string, ggufPath: string) =>
    invoke<string>("ollama_import_gguf", { modelRef, ggufPath }),
  ollamaDeleteLocalModel: (name: string) =>
    invoke<string>("ollama_delete_local_model", { name }),
  systemHardwareInfo: () => invoke<SystemHardwareInfo>("system_hardware_info"),
  listLocalGgufModels: () => invoke<LocalGgufFile[]>("list_local_gguf_models"),
  deleteLocalGguf: (path: string) => invoke<void>("delete_local_gguf", { path }),
  revealPath: (path: string) => invoke<void>("reveal_path", { path }),

  upsertQueue: (queue: Queue) => invoke<Queue[]>("upsert_queue", { queue }),
  deleteQueue: (id: string) => invoke<Queue[]>("delete_queue", { id }),
  assignToQueue: (ids: string[], queueId: string | null) =>
    invoke<void>("assign_to_queue", { ids, queueId }),
  startQueue: (id: string) => invoke<void>("start_queue", { id }),
  stopQueue: (id: string) => invoke<void>("stop_queue", { id }),
  nextScheduleRuns: () => invoke<[string, string | null][]>("next_schedule_runs"),
  cancelPostAction: () => invoke<void>("cancel_post_action"),

  grabberProjects: () => invoke<GrabberProject[]>("grabber_projects"),
  startGrabber: (name: string, config: GrabberConfig, projectId?: string) =>
    invoke<GrabberProject>("start_grabber", { projectId: projectId ?? null, name, config }),
  stopGrabber: (projectId: string) => invoke<void>("stop_grabber", { projectId }),
  deleteGrabberProject: (projectId: string) =>
    invoke<void>("delete_grabber_project", { projectId }),
  downloadGrabbed: (args: {
    projectId: string;
    urls: string[];
    saveDir?: string;
    keepStructure: boolean;
    mode?: StartMode;
  }) => invoke<number>("download_grabbed", args),
  upsertCategory: (category: Category) =>
    invoke<Category[]>("upsert_category", { category }),
  toolStatus: () => invoke<ToolStatus>("tool_status"),
  ensureTools: () => invoke<ToolStatus>("ensure_tools"),
  updateYtdlp: () => invoke<unknown>("update_ytdlp"),
  repairIntegration: () => invoke<IntegrationStatus>("repair_integration"),
  extensionFolder: (firefox: boolean) =>
    invoke<string | null>("extension_folder", { firefox }),
  openBrowser: (browser: string) => invoke<void>("open_browser", { browser }),
  openExtensionStore: (browser: string) =>
    invoke<void>("open_extension_store", { browser }),
  openPath: (path: string) => invoke<void>("open_path", { path }),
  setAutostart: (enabled: boolean) =>
    invoke<boolean>("set_autostart", { enabled }),
  dataDir: () => invoke<string>("data_dir"),

  freeSpace: (path: string) => invoke<number | null>("free_space", { path }),
  runSpeedTest: () => invoke<SpeedTestResult>("run_speed_test"),
  scanDownloadUrl: (url: string, fileName?: string) =>
    invoke<SecurityScanReport>("scan_download_url", {
      url,
      fileName: fileName ?? null,
    }),
  scanDownloadedFile: (path: string, vtApiKey?: string | null) =>
    invoke<SecurityScanReport>("scan_downloaded_file", {
      path,
      vtApiKey: vtApiKey?.trim() || null,
    }),
  updateSettings: (patch: Record<string, unknown>) =>
    invoke<Settings>("update_settings", { patch }),
  quitApp: () => invoke<void>("quit_app"),
};

// Minimal browser preview fallback when running `npm --prefix hdm-ui run dev` outside Tauri.
const MOCK_SETTINGS: Settings = {
  general: {
    launchAtStartup: true,
    startMinimized: false,
    closeToTray: true,
    hideTrayIcon: false,
    showCaptureDialog: true,
    showProgressWindow: false,
    showCompletionDialog: false,
    notifications: true,
    confirmDelete: true,
    useTrash: true,
    checkUpdates: false,
    language: "en",
    removeDeletedFiles: false,
    hideDockIcon: false,
  },
  appearance: {
    theme: "dark",
    accent: "crimson",
    density: "compact",
    motion: "system",
    reduceTransparency: true,
    windowMaterial: false,
    visibleColumns: [],
    compactView: false,
  },
  downloads: {
    defaultDir: "C:\\Users\\Houssein\\Downloads",
    useCategoryFolders: true,
    defaultConnections: 8,
    maxConnections: 32,
    conflict: "ask",
    maxRetries: 20,
    speedLimit: 5 * 1024 * 1024,
    speedLimiterEnabled: false,
    verifyChecksums: true,
    autoStart: true,
  },
  connection: {
    userAgent: "",
    connectTimeoutSecs: 15,
    readTimeoutSecs: 30,
    httpVersion: "http1",
    maxConnectionsPerHost: 0,
  },
  proxy: { mode: "system", address: "", username: "", password: "", bypass: [] },
  capture: {
    enabled: true,
    extensions: [],
    mimeTypes: [],
    excludedSites: [],
    minSizeKb: 0,
    bypassKey: "alt",
    videoButton: true,
    videoMinDurationSecs: 0,
  },
  sounds: {
    enabled: true,
    onComplete: true,
    onFailed: true,
    onQueueDone: true,
    volume: 0.6,
    completeSound: "classic",
  },
  clipboard: { monitor: true, ask: true },
  grabber: { defaultDepth: 2, maxPages: 2000, concurrentRequests: 6, respectRobots: true },
  antivirus: { enabled: false, kind: "auto", command: "", args: "", extensions: [] },
  video: {
    ytdlpPath: "",
    ffmpegPath: "",
    autoUpdate: true,
    preferredHeight: 1080,
    container: "mp4",
    audioFormat: "m4a",
    embedSubtitles: false,
    subtitleLangs: "en.*",
    embedThumbnail: true,
    embedMetadata: true,
    embedChapters: true,
    sponsorblock: "off",
    accelerate: true,
    cookiesFromBrowser: "",
    fileTemplate: "%(title)s [%(id)s].%(ext)s",
    numberPlaylistVideos: false,
  },
  huggingFace: { endpoint: "", token: "", folder: "" },
  shortcuts: {},
  onboardingDone: true,
  lastSeenVersion: "0.1.0",
};

function mockInvoke<T>(cmd: string): Promise<T> {
  switch (cmd) {
    case "bootstrap":
      return Promise.resolve({
        version: "0.1.0",
        items: [],
        categories: [],
        queues: [],
        settings: MOCK_SETTINGS,
        grabberProjects: [],
        dataDir: "",
        captures: [],
      } as T);
    case "main_window_starts_visible":
      return Promise.resolve(true as T);
    case "drain_ui_intents":
      return Promise.resolve([] as T);
    case "integration_status":
    case "repair_integration":
      return Promise.resolve({ browsers: [], extensionConnected: false } as T);
    case "tool_status":
    case "ensure_tools":
      return Promise.resolve({
        ytDlp: { source: "missing" },
        ffmpeg: { source: "missing" },
        ffprobe: { source: "missing" },
        deno: { source: "missing" },
      } as T);
    case "hf_context":
      return Promise.resolve({
        endpoint: "https://huggingface.co",
        token: null,
        folder: MOCK_SETTINGS.downloads.defaultDir,
        lmStudio: null,
      } as T);
    case "clear_missing_completed":
      return Promise.resolve(0 as T);
    case "clipboard_read":
    case "data_dir":
      return Promise.resolve("" as T);
    case "toggle_speed_limiter":
    case "set_autostart":
      return Promise.resolve(true as T);
    case "item_details":
    case "free_space":
    case "extension_folder":
    case "get_capture":
    case "get_video":
      return Promise.resolve(null as T);
    case "upsert_queue":
    case "upsert_category":
    case "zip_contents":
    case "hf_search":
    case "hf_browse":
    case "ollama_search":
    case "ollama_model_tags":
    case "list_local_gguf_models":
    case "next_schedule_runs":
    case "grabber_projects":
      return Promise.resolve([] as T);
    case "system_hardware_info":
      return Promise.resolve({
        totalRamBytes: 16 * 1024 ** 3,
        availableRamBytes: 10 * 1024 ** 3,
        gpuName: null,
        gpuVramBytes: null,
        vramSource: "cpu-only",
      } as T);
    case "ollama_local_status":
      return Promise.resolve({
        running: false,
        endpoint: "http://127.0.0.1:11434",
        modelsDir: null,
        models: [],
      } as T);
    case "update_settings":
      return Promise.resolve(MOCK_SETTINGS as T);
    case "run_speed_test":
      return Promise.resolve({ latencyMs: 18, downloadBps: 45_000_000, bytesTested: 10_485_760 } as T);
    default:
      return Promise.resolve(undefined as T);
  }
}
