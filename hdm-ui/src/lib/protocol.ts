export type ProtocolTab =
  | "direct"
  | "video"
  | "torrent"
  | "ollama"
  | "huggingface"
  | "batch";

const HF_RESERVED = new Set([
  "api",
  "docs",
  "spaces",
  "models",
  "settings",
  "blog",
  "pricing",
  "organizations",
  "collections",
  "papers",
  "learn",
  "join",
  "login",
  "logout",
  "posts",
  "chat",
  "enterprise",
  "tasks",
  "search",
  "new",
  "new-dataset",
  "new-space",
  "new-collection",
  "notifications",
  "inference-endpoints",
  "welcome",
  "terms-of-service",
  "privacy",
  "changelog",
  "hub",
  "oauth",
  "billing",
  "storage",
  "subscribe",
  "status",
  "upload",
  "inference",
  "mcp",
  "deploy",
]);

const VIDEO_HOSTS = new Set([
  "youtube.com",
  "youtu.be",
  "music.youtube.com",
  "vimeo.com",
  "twitch.tv",
  "clips.twitch.tv",
  "dailymotion.com",
  "dai.ly",
  "bilibili.com",
  "b23.tv",
  "tiktok.com",
  "vm.tiktok.com",
  "soundcloud.com",
  "rumble.com",
  "odysee.com",
  "bandcamp.com",
  "nicovideo.jp",
  "streamable.com",
  "ted.com",
]);

function normalizeHost(host: string): string {
  const lower = host.toLowerCase();
  return lower.startsWith("www.") ? lower.slice(4) : lower;
}

function validHfPart(s: string): boolean {
  return (
    s.length > 0 &&
    s.length <= 96 &&
    /^[A-Za-z0-9._-]+$/.test(s) &&
    !s.startsWith(".") &&
    !s.startsWith("-") &&
    !s.includes("..")
  );
}

export function isVideoPageUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = normalizeHost(parsed.hostname);
    if (VIDEO_HOSTS.has(host)) return true;
    for (const base of VIDEO_HOSTS) {
      if (host.endsWith(`.${base}`)) return true;
    }
    const path = parsed.pathname.toLowerCase();
    if ((host === "x.com" || host === "twitter.com") && path.includes("/status/")) {
      return true;
    }
    if (
      host === "instagram.com" &&
      (path.startsWith("/reel/") || path.startsWith("/reels/") || path.startsWith("/p/"))
    ) {
      return true;
    }
    if (
      (host === "facebook.com" || host === "fb.watch") &&
      (host === "fb.watch" || path.startsWith("/watch") || path.startsWith("/reel/"))
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function detectProtocol(rawInput: string, hfEndpoint?: string): ProtocolTab {
  const trimmed = rawInput.trim();
  if (!trimmed) return "direct";

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("ollama:") || lower.startsWith("ollama://")) {
    return "ollama";
  }
  if (lower.startsWith("magnet:?")) return "torrent";

  const pathPart = lower.split(/[?#]/)[0];
  if (!trimmed.includes("://") && pathPart.endsWith(".torrent")) {
    return "torrent";
  }
  if (pathPart.endsWith(".torrent")) {
    return "torrent";
  }

  // Non-URL Hugging Face shorthand: `owner/name` or `datasets/owner/name`
  if (!trimmed.includes("://") && !trimmed.includes("\\") && !/\s/.test(trimmed)) {
    const parts = trimmed.replace(/^\/+|\/+$/g, "").split("/");
    const rest = parts[0] === "datasets" ? parts.slice(1) : parts;
    if (
      rest.length === 2 &&
      validHfPart(rest[0]) &&
      validHfPart(rest[1]) &&
      !HF_RESERVED.has(rest[0].toLowerCase())
    ) {
      return "huggingface";
    }
  }

  if (trimmed.includes("://")) {
    try {
      const parsed = new URL(trimmed);
      const host = normalizeHost(parsed.hostname);
      let customHost = "";
      if (hfEndpoint) {
        try {
          customHost = normalizeHost(new URL(hfEndpoint).hostname);
        } catch {
          customHost = "";
        }
      }
      if (host === "ollama.com") {
        const segs = parsed.pathname.split("/").filter(Boolean);
        if (segs[0] === "library" && segs.length >= 2) {
          return "ollama";
        }
      }

      const isHfHost =
        host === "huggingface.co" ||
        host === "hf.co" ||
        host === "hf-mirror.com" ||
        (customHost !== "" && host === customHost);

      if (isHfHost) {
        const segs = parsed.pathname.split("/").filter(Boolean);
        const bodySegs = segs[0] === "datasets" ? segs.slice(1) : segs;
        if (bodySegs.includes("resolve")) return "direct";
        if (
          bodySegs.length >= 2 &&
          validHfPart(bodySegs[0]) &&
          validHfPart(bodySegs[1]) &&
          !HF_RESERVED.has(bodySegs[0].toLowerCase())
        ) {
          return "huggingface";
        }
      }

      if (isVideoPageUrl(trimmed)) return "video";
    } catch {
      return "direct";
    }
  }

  return "direct";
}
