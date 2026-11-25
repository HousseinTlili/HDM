// Types mirroring prism-core (serde camelCase) and HDM shell intents.

export type ItemKind = "http" | "ftp" | "hls" | "dash" | "video" | "torrent";

export type Status =
  | "idle"
  | "queued"
  | "connecting"
  | "downloading"
  | "retrying"
  | "paused"
  | "processing"
  | "completed"
  | "failed";

export interface VideoSection {
  start: number;
  end: number;
}

export interface MediaInfo {
  title?: string | null;
  thumbnail?: string | null;
  duration?: number | null;
  quality?: string | null;
  site?: string | null;
  pageUrl?: string | null;
  playlistIndex?: number | null;
  section?: VideoSection | null;
}

export interface DownloadItem {
  id: string;
  kind: ItemKind;
  url: string;
  finalUrl?: string | null;
  fileName: string;
  saveDir: string;
  size?: number | null;
  downloaded: number;
  status: Status;
  error?: string | null;
  category: string;
  queueId?: string | null;
  description: string;
  referer?: string | null;
  addedAt: number;
  lastTryAt?: number | null;
  finishedAt?: number | null;
  resumable?: boolean | null;
  connections: number;
  speedLimit: number;
  checksum?: string | null;
  trashed: boolean;
  position: number;
  mirrors: string[];
  grabberProject?: string | null;
  request?: Record<string, unknown> | null;
  media?: MediaInfo | null;
}

export interface Progress {
  id: string;
  status: Status;
  downloaded: number;
  size?: number | null;
  speed: number;
  etaSecs?: number | null;
  connections: number;
  detail?: string | null;
  fraction?: number | null;
}

export interface SegmentInfo {
  start: number;
  pos: number;
  end: number;
  speed: number;
  state: string;
}

export interface ItemDetails {
  item: DownloadItem;
  segments: SegmentInfo[];
  progress?: Progress | null;
  speedHistory: number[];
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  extensions: string[];
  saveDir?: string | null;
  builtin: boolean;
  position: number;
}

export type PostAction =
  | { type: "none" }
  | { type: "exit" }
  | { type: "sleep" }
  | { type: "hibernate" }
  | { type: "shutdown" }
  | { type: "lock" }
  | { type: "sound" }
  | { type: "command"; value: string };

export interface Schedule {
  enabled: boolean;
  startTime?: string | null;
  stopTime?: string | null;
  days: number[];
  onceDate?: string | null;
  retryFailed: boolean;
  onComplete: PostAction;
  wake: boolean;
}

export interface Queue {
  id: string;
  name: string;
  maxConcurrent: number;
  speedLimit: number;
  position: number;
  builtin: boolean;
  schedule: Schedule;
  running: boolean;
}

export type ConflictAction = "ask" | "rename" | "overwrite";

export interface Settings {
  general: {
    launchAtStartup: boolean;
    startMinimized: boolean;
    closeToTray: boolean;
    hideTrayIcon: boolean;
    showCaptureDialog: boolean;
    showProgressWindow: boolean;
    showCompletionDialog: boolean;
    notifications: boolean;
    confirmDelete: boolean;
    useTrash: boolean;
    checkUpdates: boolean;
    language: string;
    removeDeletedFiles: boolean;
    hideDockIcon: boolean;
  };
  appearance: {
    theme: "system" | "dark" | "light";
    accent: string;
    density: "comfortable" | "compact";
    motion: "system" | "full" | "reduced";
    reduceTransparency: boolean;
    windowMaterial: boolean;
    visibleColumns: string[];
    compactView: boolean;
  };
  downloads: {
    defaultDir: string;
    useCategoryFolders: boolean;
    defaultConnections: number;
    maxConnections: number;
    conflict: ConflictAction;
    maxRetries: number;
    speedLimit: number;
    speedLimiterEnabled: boolean;
    verifyChecksums: boolean;
    autoStart: boolean;
  };
  connection: {
    userAgent: string;
    connectTimeoutSecs: number;
    readTimeoutSecs: number;
    httpVersion: "http1" | "auto" | "http3";
    maxConnectionsPerHost: number;
  };
  proxy: {
    mode: "none" | "system" | "http" | "socks5";
    address: string;
    username: string;
    password: string;
    bypass: string[];
  };
  capture: {
    enabled: boolean;
    extensions: string[];
    mimeTypes: string[];
    excludedSites: string[];
    minSizeKb: number;
    bypassKey: "alt" | "ctrl" | "shift" | "none";
    videoButton: boolean;
    videoMinDurationSecs: number;
  };
  sounds: {
    enabled: boolean;
    onComplete: boolean;
    onFailed: boolean;
    onQueueDone: boolean;
    volume: number;
    completeSound: string;
  };
  clipboard: {
    monitor: boolean;
    ask: boolean;
  };
  grabber: {
    defaultDepth: number;
    maxPages: number;
    concurrentRequests: number;
    respectRobots: boolean;
  };
  antivirus: {
    enabled: boolean;
    kind: "auto" | "defender" | "clamav" | "custom";
    command: string;
    args: string;
    extensions: string[];
  };
  video: {
    ytdlpPath: string;
    ffmpegPath: string;
    autoUpdate: boolean;
    preferredHeight: number;
    container: string;
    audioFormat: string;
    embedSubtitles: boolean;
    subtitleLangs: string;
    embedThumbnail: boolean;
    embedMetadata: boolean;
    embedChapters: boolean;
    sponsorblock: "off" | "mark" | "remove";
    accelerate: boolean;
    cookiesFromBrowser: string;
    fileTemplate: string;
    numberPlaylistVideos: boolean;
  };
  huggingFace: {
    endpoint: string;
    token: string;
    folder: string;
  };
  shortcuts: Record<string, string>;
  onboardingDone: boolean;
  lastSeenVersion: string;
}

export type CaptureSource = "manual" | "browser" | "clipboard" | "batch" | "grabber";

export interface CaptureInfo {
  id: string;
  source: CaptureSource;
  kind: ItemKind;
  url: string;
  finalUrl?: string | null;
  fileName: string;
  size?: number | null;
  mime?: string | null;
  resumable?: boolean | null;
  category: string;
  saveDir: string;
  referer?: string | null;
  pageUrl?: string | null;
  description: string;
  probing: boolean;
  probeError?: string | null;
  exists: boolean;
  needsAuth: boolean;
}

export interface BatchEntry {
  url: string;
  fileName: string;
  size?: number | null;
  mime?: string | null;
  category: string;
  referer?: string | null;
  text?: string | null;
}

export interface BatchInfo {
  id: string;
  title: string;
  pageUrl?: string | null;
  entries: BatchEntry[];
}

export interface SniffedStream {
  url: string;
  kind: string;
  mime?: string | null;
  size?: number | null;
  label?: string | null;
}

export interface VideoCapture {
  id: string;
  pageUrl: string;
  title?: string | null;
  streams: SniffedStream[];
  preselected?: string | null;
}

export interface Bootstrap {
  version: string;
  items: DownloadItem[];
  categories: Category[];
  queues: Queue[];
  settings: Settings;
  grabberProjects: unknown[];
  dataDir: string;
  captures: CaptureInfo[];
}

export interface BrowserIntegration {
  browser: string;
  name?: string;
  supported?: boolean;
  installed: boolean;
  registered: boolean;
  pointsToThisHost: boolean;
  manifestPath?: string | null;
  note?: string | null;
}

export interface IntegrationStatus {
  hostPath?: string | null;
  hostExists?: boolean;
  extensionId?: string;
  firefoxExtensionId?: string;
  browsers: BrowserIntegration[];
  extensionConnected?: boolean;
  lastSeen?: number | null;
  extensionVersion?: string | null;
  extensionInstallType?: string | null;
  extensionOutdated?: boolean;
  appVersion?: string;
}

export type CoreEvent =
  | { type: "itemsAdded"; payload: DownloadItem[] }
  | { type: "itemUpdated"; payload: DownloadItem }
  | { type: "itemsRemoved"; payload: string[] }
  | { type: "progress"; payload: Progress[] }
  | { type: "queuesChanged"; payload: Queue[] }
  | { type: "categoriesChanged"; payload: Category[] }
  | { type: "settingsChanged"; payload: Settings }
  | { type: "captureRequested"; payload: CaptureInfo }
  | { type: "captureUpdated"; payload: CaptureInfo }
  | { type: "zipProgress"; payload: ZipProgress }
  | { type: "batchRequested"; payload: BatchInfo }
  | { type: "videoRequested"; payload: VideoCapture }
  | { type: "completed"; payload: DownloadItem }
  | { type: "failed"; payload: DownloadItem }
  | { type: "queueFinished"; payload: { queue_id: string; name: string } }
  | { type: "postActionPending"; payload: { action: PostAction; seconds: number } }
  | { type: "leftToBrowser"; payload: { host: string } }
  | { type: "openTorrent"; payload: { source: string } }
  | { type: "openModel"; payload: { source: string } }
  | { type: "clipboardUrls"; payload: string[] }
  | { type: "grabber"; payload: { project_id: string; event: GrabberEvent } }
  | { type: "toolsProgress"; payload: { tool: string; downloaded: number; total?: number | null } }
  | { type: "showMain" }
  | { type: "exitRequested" };

export type HdmIntent =
  | { seq?: number; kind: "new"; url?: string | null }
  | { seq?: number; kind: "capture"; info: CaptureInfo }
  | { seq?: number; kind: "video"; info: VideoCapture }
  | { seq?: number; kind: "torrent"; source: string }
  | { seq?: number; kind: "model"; source: string; provider?: "huggingface" | "ollama" }
  | { seq?: number; kind: "ollama"; model?: string }
  | { seq?: number; kind: "batch"; info: BatchInfo };

export type SidebarFilter =
  | "all"
  | "active"
  | "completed"
  | "queued"
  | "video"
  | "torrent"
  | "ai";

export type AppView = "downloads" | "models" | "scheduler" | "settings";

export type SortKey = "speed" | "progress" | "added" | "size";

export interface Sha256Verification {
  actual: string;
  expected?: string | null;
  matches?: boolean | null;
}

export interface SpeedTestResult {
  latencyMs: number;
  downloadBps: number;
  bytesTested: number;
}

export type StartMode =
  | { type: "now" }
  | { type: "later" }
  | { type: "queue"; queueId: string };

export interface HdmConfirmCaptureArgs {
  id: string;
  fileName?: string;
  saveDir?: string;
  category?: string;
  description?: string;
  mode?: StartMode;
  username?: string;
  password?: string;
  rememberDir?: boolean;
  conflict?: ConflictAction;
  connections?: number;
  checksum?: string;
}

export interface ItemPatch {
  fileName?: string;
  saveDir?: string;
  description?: string;
  category?: string;
  queueId?: string | null;
  url?: string;
  connections?: number;
  speedLimit?: number;
  checksum?: string | null;
  username?: string;
  password?: string;
}

export interface ToastMessage {
  id: string;
  kind: "info" | "success" | "error";
  text: string;
}

export interface ToolsProgress {
  tool: string;
  downloaded: number;
  total?: number | null;
}

export interface ZipFile {
  index: number;
  path: string;
  size: number;
  encrypted: boolean;
  extractable: boolean;
}

export interface VideoChoice {
  id: string;
  kind: "video" | "audio";
  label: string;
  subLabel: string;
  height?: number | null;
  width?: number | null;
  fps?: number | null;
  hdr: boolean;
  dynamicRange?: string | null;
  vcodec?: string | null;
  acodec?: string | null;
  estSize?: number | null;
  videoFormatId?: string | null;
  audioFormatId?: string | null;
  formatId?: string | null;
  container: "mp4" | "mkv" | "webm";
  audioFormat?: "mp3" | "m4a" | "opus" | "flac" | "wav" | null;
  audioBitrateKbps?: number | null;
  accelerable: boolean;
}

export interface SubtitleFormat {
  ext: string;
  url: string;
  protocol?: string | null;
}

export interface SubtitleTrack {
  lang: string;
  name?: string | null;
  auto: boolean;
  formats?: SubtitleFormat[];
}

export interface VideoChapter {
  start: number;
  end: number;
  title: string;
}

export interface VideoInfo {
  kind: "video";
  id: string;
  title: string;
  uploader?: string | null;
  channel?: string | null;
  duration?: number | null;
  uploadDate?: string | null;
  description?: string | null;
  thumbnail?: string | null;
  webpageUrl?: string | null;
  extractor?: string | null;
  isLive: boolean;
  liveStatus?: string | null;
  chapters: VideoChapter[];
  subtitles: SubtitleTrack[];
  formats: unknown[];
  choices: VideoChoice[];
  hasDrm: boolean;
}

export interface PlaylistEntry {
  id?: string | null;
  url: string;
  title?: string | null;
  duration?: number | null;
  thumbnail?: string | null;
  uploader?: string | null;
}

export interface PlaylistInfo {
  kind: "playlist";
  id?: string | null;
  title?: string | null;
  uploader?: string | null;
  webpageUrl?: string | null;
  extractor?: string | null;
  entries: PlaylistEntry[];
}

export type VideoProbe = VideoInfo | PlaylistInfo;

export interface VideoOutputOptions {
  container?: "mp4" | "mkv" | "webm";
  audioFormat?: "mp3" | "m4a" | "opus" | "flac" | "wav";
  embedSubtitles?: boolean;
  subLangs?: string[];
  autoSubtitles?: boolean;
  writeSubtitles?: boolean;
  embedThumbnail?: boolean;
  writeThumbnail?: boolean;
  embedMetadata?: boolean;
  embedChapters?: boolean;
  sponsorblock?: { mode: "off" | "mark" | "remove"; categories?: string[] };
}

export interface VideoEntry {
  url: string;
  title?: string | null;
  index?: number;
}

export interface VideoDecision {
  captureId: string;
  pageUrl: string;
  choice: VideoChoice;
  options: VideoOutputOptions;
  saveDir?: string;
  title?: string;
  thumbnail?: string;
  duration?: number;
  entries: VideoEntry[];
  mode: StartMode;
  oneAtATime?: boolean;
  section?: VideoSection;
  fileName?: string;
}

export type TorrentSource =
  | { type: "url"; value: string }
  | { type: "file"; value: string };

export interface TorrentFile {
  index: number;
  path: string;
  size: number;
}

export interface TorrentMeta {
  infoHash: string;
  name: string;
  totalSize: number;
  files: TorrentFile[];
}

export type HfKind = "model" | "dataset";

export interface HfFile {
  path: string;
  size: number;
  sha256?: string | null;
}

export interface HfVariant {
  label: string;
  files: string[];
  size: number;
}

export interface HfRepo {
  kind: HfKind;
  id: string;
  sha: string;
  revision: string;
  gated: boolean;
  private: boolean;
  downloads?: number | null;
  likes?: number | null;
  pipelineTag?: string | null;
  library?: string | null;
  gguf: boolean;
  files: HfFile[];
  path?: string | null;
  pageUrl: string;
  folder: string;
  suggestion: {
    variants: HfVariant[];
    variant?: string | null;
    extras: string[];
    files: string[];
  };
}

export interface HfHit {
  id: string;
  downloads?: number | null;
  likes?: number | null;
  pipelineTag?: string | null;
  gguf: boolean;
  gated: boolean;
}

export interface HfContext {
  endpoint: string;
  token?: "settings" | "environment" | "login" | null;
  folder: string;
  lmStudio?: string | null;
}

export interface HfPresent {
  onDisk: string[];
  listed: string[];
}

export interface ToolInfo {
  tool?: string;
  path?: string | null;
  version?: string | null;
  source: "managed" | "system" | "custom" | "missing" | string;
  message?: string | null;
}

export interface ToolStatus {
  ytDlp?: ToolInfo;
  ffmpeg?: ToolInfo;
  ffprobe?: ToolInfo;
  deno?: ToolInfo;
}

export type SettingsSection =
  | "engine"
  | "directories"
  | "video"
  | "torrent"
  | "huggingface"
  | "network"
  | "browser";

export type HfBrowseSort = "trending" | "downloads" | "likes" | "recent";

export interface HfBrowseArgs {
  query?: string;
  sort?: HfBrowseSort;
  ggufOnly?: boolean;
  limit?: number;
}

export interface HfBrowseHit {
  id: string;
  downloads?: number | null;
  likes?: number | null;
  pipelineTag?: string | null;
  gguf: boolean;
  gated: boolean;
  tags: string[];
  lastModified?: string | null;
}

export interface OllamaModelSummary {
  name: string;
  description: string;
  pulls?: string | null;
  capabilities: string[];
  sizes: string[];
  category: string;
  source: string;
}

export interface OllamaTagInfo {
  tag: string;
  sizeLabel?: string | null;
  context?: string | null;
  updated?: string | null;
}

export interface OllamaManifestInfo {
  model: string;
  tag: string;
  fullRef: string;
  modelDigest: string;
  modelSize: number;
  totalSize: number;
  blobUrl: string;
  fileName: string;
  hasTemplate: boolean;
  hasSystem: boolean;
  hasProjector: boolean;
  projectorDigest?: string | null;
  projectorSize?: number | null;
  defaultFolder: string;
}

export interface OllamaLocalModel {
  name: string;
  size: number;
  parameterSize?: string | null;
  quantization?: string | null;
  family?: string | null;
  modifiedAt?: string | null;
}

export interface OllamaLocalStatus {
  running: boolean;
  endpoint: string;
  modelsDir?: string | null;
  models: OllamaLocalModel[];
}

export interface OllamaDownloadArgs {
  model: string;
  tag: string;
  saveDir?: string;
  mode?: StartMode | null;
  writeModelfile?: boolean;
}

export interface OllamaDownloadResult {
  itemId: string;
  fileName: string;
  saveDir: string;
  modelfilePath?: string | null;
  size: number;
  sha256: string;
}

export interface SystemHardwareInfo {
  totalRamBytes: number;
  availableRamBytes: number;
  gpuName?: string | null;
  gpuVramBytes?: number | null;
  vramSource: string;
}

export interface LocalGgufFile {
  name: string;
  path: string;
  dir: string;
  size: number;
  modifiedMs: number;
  source: string;
}

export interface ZipProgress {
  captureId: string;
  index: number;
  done: number;
  total: number;
}

export type GrabberScope = "sameHost" | "sameDomain" | "subPath" | "any";

export interface GrabberConfig {
  startUrl: string;
  depth: number;
  scope: GrabberScope;
  extensions: string[];
  includeEmbedded: boolean;
  filesAnyHost: boolean;
  maxPages: number;
  concurrency: number;
  exclude: string[];
  fetchSizes: boolean;
  userAgent: string;
  cookies: string;
}

export interface GrabberFoundFile {
  url: string;
  fileName: string;
  size?: number | null;
  mime?: string | null;
  referer: string;
  depth: number;
}

export interface GrabberProject {
  id: string;
  name: string;
  config: GrabberConfig;
  files: GrabberFoundFile[];
  status: string;
  pagesVisited: number;
  createdAt: number;
}

export type GrabberEvent =
  | { type: "pageVisited"; url: string; depth: number; pages: number; queued: number }
  | { type: "fileFound"; file: GrabberFoundFile }
  | { type: "pageError"; url: string; error: string }
  | { type: "finished"; pages: number; files: number; cancelled: boolean };

export type SecurityVerdict = "clean" | "caution" | "harmful";

export interface SecurityFinding {
  severity: "harmful" | "caution";
  category: string;
  source: string;
  title: string;
  detail: string;
}

export interface SecurityScanReport {
  verdict: SecurityVerdict;
  sha256?: string | null;
  fileName: string;
  ignoredCrackLabels: number;
  checkedSources: string[];
  findings: SecurityFinding[];
  scannedAt: number;
}
