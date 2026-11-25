import { useEffect, useRef, useState } from "react";
import { Download, FolderOpen, RefreshCw, Sliders } from "lucide-react";
import { useFreeSpace } from "../../hooks/useFreeSpace";
import { pickFolder } from "../../lib/dialog";
import { formatBytes, formatEta } from "../../lib/format";
import { ipc } from "../../lib/ipc";
import type {
  PlaylistInfo,
  StartMode,
  VideoCapture,
  VideoChoice,
  VideoInfo,
  VideoProbe,
} from "../../lib/types";
import { useDownloadsStore } from "../../store/downloadsStore";
import { useUiStore } from "../../store/uiStore";

interface VideoTabProps {
  initialUrl: string;
  initialVideoCapture?: VideoCapture;
  onVideoCaptureIdChange: (id: string | null) => void;
  onDone: () => void;
}

function buildPlaylistChoice(
  mode: "video" | "audio",
  container: "mp4" | "mkv" | "webm",
  audioFormat: "mp3" | "m4a" | "opus" | "flac" | "wav",
  maxHeight: number | null
): VideoChoice {
  return {
    id: mode === "audio" ? `a-${audioFormat}` : `v-${maxHeight ?? "best"}`,
    kind: mode,
    label:
      mode === "audio"
        ? `Audio • ${audioFormat.toUpperCase()}`
        : maxHeight
        ? `${maxHeight}p`
        : "Best Video",
    subLabel:
      mode === "audio" ? audioFormat.toUpperCase() : container.toUpperCase(),
    height: mode === "video" ? maxHeight : null,
    hdr: false,
    container,
    audioFormat: mode === "audio" ? audioFormat : null,
    accelerable: true,
  };
}

export function VideoTab({
  initialUrl,
  initialVideoCapture,
  onVideoCaptureIdChange,
  onDone,
}: VideoTabProps) {
  const settings = useDownloadsStore((s) => s.settings);
  const pushToast = useUiStore((s) => s.pushToast);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const setSettingsSection = useUiStore((s) => s.setSettingsSection);

  const defaultDir = settings?.downloads.defaultDir ?? "";

  const [url, setUrl] = useState(initialVideoCapture?.pageUrl ?? initialUrl);
  const [probe, setProbe] = useState<VideoProbe | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [kindFilter, setKindFilter] = useState<"video" | "audio">("video");
  const [selectedChoiceId, setSelectedChoiceId] = useState<string>("");
  const [fileName, setFileName] = useState("");
  const [saveDir, setSaveDir] = useState(defaultDir);

  const [container, setContainer] = useState<"mp4" | "mkv" | "webm">(
    (settings?.video.container as "mp4" | "mkv" | "webm") || "mp4"
  );
  const [audioFormat, setAudioFormat] = useState<
    "mp3" | "m4a" | "opus" | "flac" | "wav"
  >(
    (settings?.video.audioFormat as "mp3" | "m4a" | "opus" | "flac" | "wav") ||
      "m4a"
  );
  const [embedSubtitles, setEmbedSubtitles] = useState(
    settings?.video.embedSubtitles ?? false
  );
  const [subLangs, setSubLangs] = useState(
    settings?.video.subtitleLangs || "en.*"
  );
  const [embedThumbnail, setEmbedThumbnail] = useState(
    settings?.video.embedThumbnail ?? true
  );
  const [embedMetadata, setEmbedMetadata] = useState(
    settings?.video.embedMetadata ?? true
  );
  const [embedChapters, setEmbedChapters] = useState(
    settings?.video.embedChapters ?? true
  );
  const [sponsorblock, setSponsorblock] = useState<"off" | "mark" | "remove">(
    settings?.video.sponsorblock ?? "off"
  );

  // Playlist state
  const [selectedEntryUrls, setSelectedEntryUrls] = useState<Set<string>>(
    () => new Set()
  );
  const [oneAtATime, setOneAtATime] = useState(true);
  const [playlistMaxHeight, setPlaylistMaxHeight] = useState<number | null>(
    settings?.video.preferredHeight ?? 1080
  );

  const freeBytes = useFreeSpace(saveDir);

  useEffect(() => {
    onVideoCaptureIdChange(initialVideoCapture?.id ?? null);
  }, [initialVideoCapture?.id, onVideoCaptureIdChange]);

  const runProbe = async (target: string) => {
    const trimmed = target.trim();
    if (!trimmed) {
      setProbeError("Enter a video or playlist URL.");
      return;
    }
    setProbing(true);
    setProbeError(null);
    try {
      const result = await ipc.probeVideo(trimmed);
      setProbe(result);
      if (result.kind === "video") {
        setFileName(result.title || "");
        const preferredHeight = settings?.video.preferredHeight ?? 1080;
        const videoChoices = result.choices.filter((c) => c.kind === "video");
        const bestMatch =
          videoChoices.find((c) => (c.height ?? 0) <= preferredHeight) ??
          videoChoices[0] ??
          result.choices[0];
        if (bestMatch) {
          setKindFilter(bestMatch.kind);
          setSelectedChoiceId(bestMatch.id);
        }
      } else {
        setSelectedEntryUrls(new Set(result.entries.map((e) => e.url)));
      }
    } catch (err) {
      setProbeError(err instanceof Error ? err.message : String(err));
    } finally {
      setProbing(false);
    }
  };

  const didAutoProbe = useRef(false);
  useEffect(() => {
    if (didAutoProbe.current) return;
    const initTarget = (initialVideoCapture?.pageUrl ?? initialUrl).trim();
    if (initTarget) {
      didAutoProbe.current = true;
      void runProbe(initTarget);
    }
  });

  const handleBrowse = async () => {
    const picked = await pickFolder(saveDir || defaultDir);
    if (picked) setSaveDir(picked);
  };

  const videoInfo: VideoInfo | null =
    probe?.kind === "video" ? probe : null;
  const playlistInfo: PlaylistInfo | null =
    probe?.kind === "playlist" ? probe : null;

  const visibleChoices = videoInfo
    ? videoInfo.choices.filter((c) => c.kind === kindFilter)
    : [];
  const selectedChoice =
    visibleChoices.find((c) => c.id === selectedChoiceId) ??
    visibleChoices[0] ??
    videoInfo?.choices[0] ??
    null;

  const submitDecision = async (mode: StartMode) => {
    if (!probe || submitting) return;
    setSubmitting(true);
    setProbeError(null);

    const options = {
      container,
      audioFormat,
      embedSubtitles,
      subLangs: subLangs
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      embedThumbnail,
      embedMetadata,
      embedChapters,
      sponsorblock: { mode: sponsorblock },
    };

    try {
      if (videoInfo && selectedChoice) {
        await ipc.confirmVideo({
          captureId: initialVideoCapture?.id ?? "",
          pageUrl: videoInfo.webpageUrl || url.trim(),
          choice: { ...selectedChoice, container },
          options,
          saveDir: saveDir.trim() || defaultDir,
          title: videoInfo.title,
          thumbnail: videoInfo.thumbnail ?? undefined,
          duration: videoInfo.duration ?? undefined,
          entries: [],
          mode,
          fileName: fileName.trim() || undefined,
        });
        onVideoCaptureIdChange(null);
        pushToast("success", `Queued ${fileName.trim() || videoInfo.title}`);
        onDone();
      } else if (playlistInfo) {
        const picked = playlistInfo.entries
          .map((entry, idx) => ({ entry, index: idx + 1 }))
          .filter(({ entry }) => selectedEntryUrls.has(entry.url))
          .map(({ entry, index }) => ({
            url: entry.url,
            title: entry.title ?? undefined,
            index,
          }));
        if (picked.length === 0) {
          setProbeError("Select at least one playlist entry.");
          setSubmitting(false);
          return;
        }
        const count = await ipc.confirmVideo({
          captureId: initialVideoCapture?.id ?? "",
          pageUrl: playlistInfo.webpageUrl || url.trim(),
          choice: buildPlaylistChoice(
            kindFilter,
            container,
            audioFormat,
            playlistMaxHeight
          ),
          options,
          saveDir: saveDir.trim() || defaultDir,
          title: playlistInfo.title ?? undefined,
          entries: picked,
          mode,
          oneAtATime,
        });
        onVideoCaptureIdChange(null);
        pushToast("success", `Added ${count} playlist video(s)`);
        onDone();
      }
    } catch (err) {
      setProbeError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="p-5 flex flex-col gap-4 overflow-y-auto min-h-0">
        {/* Video / Page URL */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="hdm-video-url"
            className="font-label text-label-md text-on-surface"
          >
            Video or Playlist URL (yt-dlp)
          </label>
          <div className="flex items-center gap-2">
            <input
              id="hdm-video-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void runProbe(url);
                }
              }}
              placeholder="https://www.youtube.com/watch?v=..."
              className="flex-1 h-9 px-3 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary"
            />
            <button
              type="button"
              disabled={probing || !url.trim()}
              onClick={() => void runProbe(url)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded bg-surface-container-high border border-outline font-label text-label-md text-on-surface hover:border-primary/40 disabled:opacity-50"
            >
              <RefreshCw
                size={13}
                className={probing ? "animate-spin" : ""}
                aria-hidden="true"
              />
              <span>{probing ? "Probing…" : "Probe Video"}</span>
            </button>
          </div>
        </div>

        {probeError && (
          <div className="rounded-md bg-primary-tint border border-primary/40 p-3 flex items-center justify-between gap-3">
            <span className="font-mono text-mono-sm text-on-primary-badge break-words">
              {probeError}
            </span>
            <button
              type="button"
              onClick={() => {
                setSettingsSection("video");
                setActiveView("settings");
                onDone();
              }}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded bg-surface-container border border-outline font-label text-label-sm text-on-surface hover:border-primary/40 shrink-0"
            >
              <Sliders size={12} aria-hidden="true" />
              <span>yt-dlp Setup</span>
            </button>
          </div>
        )}

        {/* Fallback Sniffed Streams from Browser Extension when yt-dlp probe fails */}
        {probeError &&
          initialVideoCapture &&
          initialVideoCapture.streams.length > 0 && (
            <div className="rounded-md bg-surface border border-outline p-3 flex flex-col gap-2">
              <span className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
                Captured Browser Media Streams
              </span>
              <div className="flex flex-col gap-1.5">
                {initialVideoCapture.streams.map((stream, i) => (
                  <div
                    key={`${stream.url}-${i}`}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-surface-container border border-outline"
                  >
                    <span className="font-mono text-mono-sm text-on-surface truncate">
                      {stream.label || stream.kind} ({formatBytes(stream.size)})
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        void ipc
                          .addStream(
                            stream,
                            initialVideoCapture.pageUrl,
                            initialVideoCapture.title ?? undefined
                          )
                          .then(() => {
                            pushToast("success", "Started browser stream download");
                            onDone();
                          })
                          .catch((err) =>
                            setProbeError(
                              err instanceof Error ? err.message : String(err)
                            )
                          );
                      }}
                      className="h-6 px-2.5 rounded bg-primary text-on-primary font-label text-label-sm shrink-0"
                    >
                      Download Stream
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

        {/* Single Video Probe Result */}
        {videoInfo && (
          <>
            <div className="rounded-md bg-surface border border-outline p-3.5 flex items-start justify-between gap-3">
              <div className="min-w-0 flex flex-col gap-1">
                <span className="font-title text-title-md text-on-surface">
                  {videoInfo.title}
                </span>
                <div className="flex items-center gap-2 font-mono text-mono-sm text-on-surface-variant flex-wrap">
                  <span>{videoInfo.extractor}</span>
                  {(videoInfo.uploader || videoInfo.channel) && (
                    <span>• {videoInfo.uploader || videoInfo.channel}</span>
                  )}
                  {videoInfo.duration != null && (
                    <span>• {formatEta(videoInfo.duration)}</span>
                  )}
                  {videoInfo.isLive && (
                    <span className="text-on-primary-badge">• LIVE</span>
                  )}
                </div>
              </div>
              {videoInfo.hasDrm && (
                <span className="font-mono text-mono-sm px-2 py-0.5 rounded-sm bg-primary-badge border border-primary/40 text-on-primary-badge shrink-0">
                  DRM Protected
                </span>
              )}
            </div>

            {/* Format / Quality Picker */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 rounded bg-surface border border-outline p-0.5">
                  <button
                    type="button"
                    onClick={() => setKindFilter("video")}
                    className={`h-6 px-2.5 rounded-sm font-label text-label-sm ${
                      kindFilter === "video"
                        ? "bg-primary-tint text-on-primary-badge border border-primary/40"
                        : "text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    Video + Audio
                  </button>
                  <button
                    type="button"
                    onClick={() => setKindFilter("audio")}
                    className={`h-6 px-2.5 rounded-sm font-label text-label-sm ${
                      kindFilter === "audio"
                        ? "bg-primary-tint text-on-primary-badge border border-primary/40"
                        : "text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    Audio Only
                  </button>
                </div>
                <span className="font-mono text-mono-sm text-on-surface-variant tabular">
                  {visibleChoices.length} formats
                </span>
              </div>

              <div className="max-h-40 overflow-y-auto rounded-md bg-surface border border-outline divide-y divide-outline-subtle">
                {visibleChoices.map((choice) => {
                  const chosen = selectedChoice?.id === choice.id;
                  return (
                    <button
                      key={choice.id}
                      type="button"
                      onClick={() => setSelectedChoiceId(choice.id)}
                      className={`w-full px-3 py-2 flex items-center justify-between text-left transition-colors duration-state-change ease-state-change ${
                        chosen
                          ? "bg-primary-tint border-l-2 border-l-primary text-on-surface"
                          : "hover:bg-surface-container-high border-l-2 border-l-transparent text-on-surface-variant"
                      }`}
                    >
                      <span className="font-mono text-mono-sm text-on-surface">
                        {choice.label}
                      </span>
                      <span className="font-mono text-mono-sm tabular text-on-surface-variant">
                        {choice.subLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-12 gap-3">
              <label className="col-span-6 flex flex-col gap-1">
                <span className="font-label text-label-sm text-on-surface-variant">
                  Output Filename
                </span>
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  className="h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface focus:outline-none focus:border-primary"
                />
              </label>

              <div className="col-span-6 flex flex-col gap-1">
                <span className="font-label text-label-sm text-on-surface-variant">
                  Save Directory
                </span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={saveDir}
                    onChange={(e) => setSaveDir(e.target.value)}
                    className="flex-1 h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface focus:outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={() => void handleBrowse()}
                    aria-label="Browse folder"
                    className="inline-flex items-center justify-center w-8 h-8 rounded bg-surface-container-high border border-outline text-on-surface-variant hover:text-on-surface"
                  >
                    <FolderOpen size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Playlist Probe Result */}
        {playlistInfo && (
          <>
            <div className="rounded-md bg-surface border border-outline p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-title text-title-md text-on-surface truncate">
                  {playlistInfo.title || "Playlist"}
                </div>
                <div className="font-mono text-mono-sm text-on-surface-variant">
                  {selectedEntryUrls.size} / {playlistInfo.entries.length} selected
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedEntryUrls(
                      new Set(playlistInfo.entries.map((e) => e.url))
                    )
                  }
                  className="h-7 px-2 rounded bg-surface-container-high border border-outline font-label text-label-sm text-on-surface"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedEntryUrls(new Set())}
                  className="h-7 px-2 rounded bg-surface-container-high border border-outline font-label text-label-sm text-on-surface"
                >
                  None
                </button>
              </div>
            </div>

            <div className="max-h-40 overflow-y-auto rounded-md bg-surface border border-outline divide-y divide-outline-subtle">
              {playlistInfo.entries.map((entry, idx) => {
                const checked = selectedEntryUrls.has(entry.url);
                return (
                  <label
                    key={`${entry.url}-${idx}`}
                    className="px-3 py-1.5 flex items-center justify-between gap-2 cursor-pointer hover:bg-surface-container-high"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedEntryUrls((prev) => {
                            const next = new Set(prev);
                            if (next.has(entry.url)) next.delete(entry.url);
                            else next.add(entry.url);
                            return next;
                          })
                        }
                        className="accent-[#E11D2E]"
                      />
                      <span className="font-mono text-mono-sm text-on-surface-variant tabular">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <span className="font-body text-body-sm text-on-surface truncate">
                        {entry.title || entry.url}
                      </span>
                    </span>
                    <span className="font-mono text-mono-sm tabular text-on-surface-variant shrink-0">
                      {entry.duration != null ? formatEta(entry.duration) : "—"}
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="grid grid-cols-12 gap-3 items-end">
              <div className="col-span-6 flex flex-col gap-1">
                <span className="font-label text-label-sm text-on-surface-variant">
                  Save Directory
                </span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={saveDir}
                    onChange={(e) => setSaveDir(e.target.value)}
                    className="flex-1 h-8 px-2.5 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface focus:outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={() => void handleBrowse()}
                    aria-label="Browse folder"
                    className="inline-flex items-center justify-center w-8 h-8 rounded bg-surface-container-high border border-outline text-on-surface-variant hover:text-on-surface"
                  >
                    <FolderOpen size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>

              <label className="col-span-3 flex flex-col gap-1">
                <span className="font-label text-label-sm text-on-surface-variant">
                  Max Quality
                </span>
                <select
                  value={playlistMaxHeight ?? 0}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (v === -1) {
                      setKindFilter("audio");
                      setPlaylistMaxHeight(null);
                    } else {
                      setKindFilter("video");
                      setPlaylistMaxHeight(v === 0 ? null : v);
                    }
                  }}
                  className="h-8 px-2 rounded bg-surface border border-outline font-mono text-mono-sm text-on-surface focus:outline-none focus:border-primary"
                >
                  <option value={2160}>2160p (4K)</option>
                  <option value={1440}>1440p</option>
                  <option value={1080}>1080p</option>
                  <option value={720}>720p</option>
                  <option value={480}>480p</option>
                  <option value={0}>Best Available</option>
                  <option value={-1}>Audio Only</option>
                </select>
              </label>

              <label className="col-span-3 flex items-center gap-2 h-8 px-2.5 rounded bg-surface border border-outline cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={oneAtATime}
                  onChange={(e) => setOneAtATime(e.target.checked)}
                  className="accent-[#E11D2E]"
                />
                <span className="font-label text-label-sm text-on-surface">
                  One at a time
                </span>
              </label>
            </div>
          </>
        )}

        {/* Output Format & Metadata Options */}
        {probe && (
          <div className="rounded-md bg-surface border border-outline p-3 flex flex-col gap-2.5">
            <div className="grid grid-cols-12 gap-3">
              <label className="col-span-4 flex flex-col gap-1">
                <span className="font-label text-label-sm text-on-surface-variant">
                  Container
                </span>
                <select
                  value={container}
                  onChange={(e) =>
                    setContainer(e.target.value as "mp4" | "mkv" | "webm")
                  }
                  className="h-7 px-2 rounded bg-surface-container border border-outline font-mono text-mono-sm text-on-surface"
                >
                  <option value="mp4">MP4</option>
                  <option value="mkv">MKV</option>
                  <option value="webm">WebM</option>
                </select>
              </label>

              <label className="col-span-4 flex flex-col gap-1">
                <span className="font-label text-label-sm text-on-surface-variant">
                  Audio Codec
                </span>
                <select
                  value={audioFormat}
                  onChange={(e) =>
                    setAudioFormat(
                      e.target.value as "mp3" | "m4a" | "opus" | "flac" | "wav"
                    )
                  }
                  className="h-7 px-2 rounded bg-surface-container border border-outline font-mono text-mono-sm text-on-surface"
                >
                  <option value="m4a">M4A</option>
                  <option value="mp3">MP3</option>
                  <option value="opus">Opus</option>
                  <option value="flac">FLAC</option>
                  <option value="wav">WAV</option>
                </select>
              </label>

              <label className="col-span-4 flex flex-col gap-1">
                <span className="font-label text-label-sm text-on-surface-variant">
                  SponsorBlock
                </span>
                <select
                  value={sponsorblock}
                  onChange={(e) =>
                    setSponsorblock(
                      e.target.value as "off" | "mark" | "remove"
                    )
                  }
                  className="h-7 px-2 rounded bg-surface-container border border-outline font-mono text-mono-sm text-on-surface"
                >
                  <option value="off">Off</option>
                  <option value="mark">Mark Chapters</option>
                  <option value="remove">Remove Segments</option>
                </select>
              </label>
            </div>

            <div className="flex items-center gap-4 flex-wrap pt-1">
              <label className="inline-flex items-center gap-1.5 font-label text-label-sm text-on-surface cursor-pointer">
                <input
                  type="checkbox"
                  checked={embedSubtitles}
                  onChange={(e) => setEmbedSubtitles(e.target.checked)}
                  className="accent-[#E11D2E]"
                />
                <span>Subtitles</span>
              </label>
              {embedSubtitles && (
                <input
                  type="text"
                  value={subLangs}
                  onChange={(e) => setSubLangs(e.target.value)}
                  placeholder="en.*"
                  className="w-24 h-6 px-2 rounded bg-surface-container border border-outline font-mono text-mono-sm text-on-surface"
                />
              )}
              <label className="inline-flex items-center gap-1.5 font-label text-label-sm text-on-surface cursor-pointer">
                <input
                  type="checkbox"
                  checked={embedThumbnail}
                  onChange={(e) => setEmbedThumbnail(e.target.checked)}
                  className="accent-[#E11D2E]"
                />
                <span>Thumbnail</span>
              </label>
              <label className="inline-flex items-center gap-1.5 font-label text-label-sm text-on-surface cursor-pointer">
                <input
                  type="checkbox"
                  checked={embedMetadata}
                  onChange={(e) => setEmbedMetadata(e.target.checked)}
                  className="accent-[#E11D2E]"
                />
                <span>Metadata</span>
              </label>
              <label className="inline-flex items-center gap-1.5 font-label text-label-sm text-on-surface cursor-pointer">
                <input
                  type="checkbox"
                  checked={embedChapters}
                  onChange={(e) => setEmbedChapters(e.target.checked)}
                  className="accent-[#E11D2E]"
                />
                <span>Chapters</span>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3.5 border-t border-outline bg-surface flex items-center justify-between gap-3 shrink-0">
        <span className="font-mono text-mono-sm tabular text-on-surface-variant truncate">
          Free disk space: {freeBytes != null ? formatBytes(freeBytes) : "—"}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={!probe || submitting}
            onClick={() => void submitDecision({ type: "later" })}
            className="h-8 px-3 rounded bg-surface-container-high border border-outline text-on-surface font-label text-label-md hover:border-primary/40 disabled:opacity-40"
          >
            Save Idle
          </button>
          <button
            type="button"
            disabled={!probe || submitting}
            onClick={() => void submitDecision({ type: "now" })}
            className="inline-flex items-center gap-1.5 h-8 px-4 rounded bg-primary text-on-primary font-label text-label-md hover:bg-primary/90 disabled:opacity-40"
          >
            <Download size={14} aria-hidden="true" />
            <span>{submitting ? "Adding…" : "Start Download"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
