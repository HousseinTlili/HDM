import type { DownloadItem, Progress, SidebarFilter, SortKey, Status } from "./types";

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const decimals = idx === 0 ? 0 : idx >= 2 ? 2 : 1;
  return `${value.toFixed(decimals)} ${units[idx]}`;
}

export function formatSpeed(bps: number | null | undefined): string {
  if (!bps || bps <= 0) return "0.0 MB/s";
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let value = bps;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const decimals = idx === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[idx]}`;
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function computeAverageSpeedBps(
  startBytes: number,
  currentBytes: number,
  elapsedMs: number,
  fallbackSamples: number[]
): number {
  const deltaBytes = currentBytes - startBytes;
  if (elapsedMs >= 2000 && deltaBytes > 0) {
    return deltaBytes / (elapsedMs / 1000);
  }
  let sum = 0;
  let count = 0;
  for (const s of fallbackSamples) {
    if (Number.isFinite(s) && s > 0) {
      sum += s;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

export function computeAverageEtaSecs(
  downloaded: number,
  totalSize: number | null | undefined,
  avgSpeedBps: number | null | undefined
): number | null {
  if (totalSize == null || !Number.isFinite(totalSize) || totalSize <= 0) {
    return null;
  }
  if (downloaded >= totalSize) return 0;
  if (avgSpeedBps == null || !Number.isFinite(avgSpeedBps) || avgSpeedBps <= 0) {
    return null;
  }
  return Math.ceil((totalSize - downloaded) / avgSpeedBps);
}

export function isActiveStatus(status: Status): boolean {
  return (
    status === "connecting" ||
    status === "downloading" ||
    status === "retrying" ||
    status === "processing"
  );
}

export function isQueuedStatus(status: Status): boolean {
  return status === "queued";
}

export function isHuggingFaceHost(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host === "huggingface.co" || host === "hf.co" || host === "hf-mirror.com" || host.endsWith(".huggingface.co");
  } catch {
    return false;
  }
}

export function isAiModelItem(item: DownloadItem): boolean {
  return (
    item.queueId === "huggingface" ||
    item.fileName.toLowerCase().endsWith(".gguf") ||
    isHuggingFaceHost(item.url)
  );
}

export function isVideoItem(item: DownloadItem): boolean {
  return item.kind === "video" || item.kind === "hls" || item.kind === "dash";
}

export function matchesSidebarFilter(item: DownloadItem, filter: SidebarFilter): boolean {
  if (item.trashed) return false;
  switch (filter) {
    case "all":
      return true;
    case "active":
      return isActiveStatus(item.status);
    case "completed":
      return item.status === "completed";
    case "queued":
      return isQueuedStatus(item.status);
    case "video":
      return isVideoItem(item);
    case "torrent":
      return item.kind === "torrent";
    case "ai":
      return isAiModelItem(item);
  }
}

export interface SidebarCounts {
  all: number;
  active: number;
  completed: number;
  queued: number;
  video: number;
  torrent: number;
  ai: number;
}

export function computeSidebarCounts(items: DownloadItem[]): SidebarCounts {
  const counts: SidebarCounts = {
    all: 0,
    active: 0,
    completed: 0,
    queued: 0,
    video: 0,
    torrent: 0,
    ai: 0,
  };
  for (const item of items) {
    if (item.trashed) continue;
    counts.all += 1;
    if (isActiveStatus(item.status)) counts.active += 1;
    if (item.status === "completed") counts.completed += 1;
    if (isQueuedStatus(item.status)) counts.queued += 1;
    if (isVideoItem(item)) counts.video += 1;
    if (item.kind === "torrent") counts.torrent += 1;
    if (isAiModelItem(item)) counts.ai += 1;
  }
  return counts;
}

export function computeProgressPct(item: DownloadItem, progress?: Progress): number {
  if (item.status === "completed") return 100;
  if (progress?.fraction != null && Number.isFinite(progress.fraction)) {
    return Math.min(100, Math.max(0, progress.fraction * 100));
  }
  const downloaded = progress?.downloaded ?? item.downloaded;
  const size = progress?.size ?? item.size;
  if (size != null && size > 0) {
    return Math.min(100, Math.max(0, (downloaded / size) * 100));
  }
  return 0;
}

export function extractDomain(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().startsWith("magnet:")) {
    return "BitTorrent Magnet";
  }
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname;
    if (isHuggingFaceHost(trimmed)) {
      const firstSeg = parsed.pathname.split("/").filter(Boolean)[0];
      return firstSeg ? `${host}/${firstSeg}` : host;
    }
    return host;
  } catch {
    return "";
  }
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatRelativeTime(timestampMs: number | null | undefined, nowMs = Date.now()): string {
  if (timestampMs == null || !Number.isFinite(timestampMs) || timestampMs <= 0) return "—";
  const diffSecs = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
  if (diffSecs < 60) return "now";
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d`;
  const d = new Date(timestampMs);
  return `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function joinPath(dir: string, fileName: string): string {
  if (!dir) return fileName;
  if (!fileName) return dir;
  const sep = dir.includes("\\") ? "\\" : "/";
  const cleanDir = dir.replace(/[\\/]+$/, "");
  const cleanName = fileName.replace(/^[\\/]+/, "");
  return `${cleanDir}${sep}${cleanName}`;
}

export function protocolBadge(item: DownloadItem): string {
  if (isAiModelItem(item)) return "HF-LFS";
  if (item.kind === "torrent") return "BitTorrent";
  if (isVideoItem(item)) return "yt-dlp";
  if (item.kind === "ftp") return "FTP";
  return item.url.trim().toLowerCase().startsWith("https://") ? "HTTPS" : "HTTP";
}

export function statusLabel(status: Status): string {
  switch (status) {
    case "downloading":
      return "Downloading";
    case "connecting":
      return "Connecting";
    case "retrying":
      return "Retrying";
    case "processing":
      return "Processing";
    case "queued":
      return "Queued";
    case "paused":
      return "Paused";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "idle":
      return "Idle";
  }
}

export function filterAndSortItems(
  items: DownloadItem[],
  progressById: Record<string, Progress>,
  filter: SidebarFilter,
  searchQuery: string,
  sortBy: SortKey
): DownloadItem[] {
  const q = searchQuery.trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (!matchesSidebarFilter(item, filter)) return false;
    if (!q) return true;
    const hay = [
      item.fileName,
      item.url,
      item.saveDir,
      item.category,
      item.media?.title ?? "",
    ];
    return hay.some((field) => field.toLowerCase().includes(q));
  });

  const sorted = [...filtered];
  sorted.sort((a, b) => {
    const pa = progressById[a.id];
    const pb = progressById[b.id];
    let diff = 0;

    switch (sortBy) {
      case "speed": {
        const sa = pa?.speed ?? 0;
        const sb = pb?.speed ?? 0;
        diff = sb - sa;
        if (diff === 0) {
          const aa = isActiveStatus(a.status) ? 1 : 0;
          const ab = isActiveStatus(b.status) ? 1 : 0;
          diff = ab - aa;
        }
        break;
      }
      case "progress": {
        const pctA = computeProgressPct(a, pa);
        const pctB = computeProgressPct(b, pb);
        diff = pctB - pctA;
        break;
      }
      case "added": {
        diff = b.addedAt - a.addedAt;
        break;
      }
      case "size": {
        const sizeA = pa?.size ?? a.size ?? a.downloaded;
        const sizeB = pb?.size ?? b.size ?? b.downloaded;
        diff = sizeB - sizeA;
        break;
      }
    }

    if (diff !== 0) return diff;
    const addedDiff = b.addedAt - a.addedAt;
    if (addedDiff !== 0) return addedDiff;
    return a.id.localeCompare(b.id);
  });

  return sorted;
}

export function looksLikeDownloadLink(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) return false;
  const lower = trimmed.toLowerCase();
  return (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("ftp://") ||
    lower.startsWith("ftps://") ||
    lower.startsWith("magnet:?")
  );
}
