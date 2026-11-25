import { isActiveStatus } from "./format";
import type { SegmentInfo, Status } from "./types";

export type ChunkCellState = "done" | "active" | "queued" | "failed";

export interface ChunkCell {
  index: number;
  state: ChunkCellState;
  startByte: number;
  endByte: number;
  activeSpeed: number;
}

export interface NormalizedChunkMap {
  cells: ChunkCell[];
  doneCount: number;
  activeCount: number;
}

export function normalizeSegmentsTo32(
  segments: SegmentInfo[],
  totalSize: number | null | undefined,
  status: Status,
  downloaded: number
): NormalizedChunkMap {
  const total = totalSize != null && totalSize > 0 ? totalSize : 0;

  if (status === "completed") {
    const cells: ChunkCell[] = Array.from({ length: 32 }, (_, index) => ({
      index,
      state: "done",
      startByte: total > 0 ? Math.floor((index * total) / 32) : index,
      endByte: total > 0 ? Math.floor(((index + 1) * total) / 32) : index + 1,
      activeSpeed: 0,
    }));
    return { cells, doneCount: 32, activeCount: 0 };
  }

  if (segments.length > 0 && total > 0) {
    // Handle both byte-offset segments (HTTP/FTP) and segment-index units (HLS/DASH where end << total)
    const maxSegEnd = segments.reduce(
      (m, s) => (Number.isFinite(s.end) && s.end < Number.MAX_SAFE_INTEGER ? Math.max(m, s.end) : m),
      0
    );
    const domain = maxSegEnd > 0 && maxSegEnd <= segments.length * 4 && total > maxSegEnd * 64
      ? maxSegEnd
      : total;

    const cells: ChunkCell[] = [];
    let doneCount = 0;
    let activeCount = 0;

    for (let i = 0; i < 32; i++) {
      const bStart = Math.floor((i * domain) / 32);
      const bEnd = Math.max(bStart + 1, Math.floor(((i + 1) * domain) / 32));
      const bucketSpan = Math.max(1, bEnd - bStart);

      let doneOverlap = 0;
      let hasActive = false;
      let hasFailed = false;
      let activeSpeed = 0;

      for (const seg of segments) {
        const segEnd = Math.min(seg.end, domain);
        if (segEnd <= bStart || seg.start >= bEnd) continue;

        const segPos = Math.min(Math.max(seg.pos, seg.start), segEnd);
        const overlapStart = Math.max(seg.start, bStart);
        const overlapDoneEnd = Math.min(segPos, bEnd);
        if (overlapDoneEnd > overlapStart) {
          doneOverlap += overlapDoneEnd - overlapStart;
        }

        const remIntersects = segEnd > Math.max(segPos, bStart) && segPos < bEnd;
        const activeFrontier = segPos >= bStart && segPos < bEnd;

        if (seg.state === "active" && (remIntersects || activeFrontier)) {
          hasActive = true;
          activeSpeed += seg.speed;
        } else if (
          (seg.state === "failed" || seg.state === "retrying") &&
          remIntersects
        ) {
          hasFailed = true;
        }
      }

      let state: ChunkCellState;
      if (doneOverlap >= bucketSpan * 0.995) {
        state = "done";
        doneCount += 1;
      } else if (hasActive) {
        state = "active";
        activeCount += 1;
      } else if (hasFailed) {
        state = "failed";
      } else {
        state = "queued";
      }

      cells.push({
        index: i,
        state,
        startByte: Math.floor((i * total) / 32),
        endByte: Math.floor(((i + 1) * total) / 32),
        activeSpeed,
      });
    }

    return { cells, doneCount, activeCount };
  }

  if (total > 0 && downloaded > 0) {
    const done = Math.min(32, Math.floor((downloaded / total) * 32));
    const active = isActiveStatus(status);
    let activeCount = 0;
    const cells: ChunkCell[] = Array.from({ length: 32 }, (_, i) => {
      let state: ChunkCellState = "queued";
      if (i < done) state = "done";
      else if (i === done && active) {
        state = "active";
        activeCount = 1;
      }
      return {
        index: i,
        state,
        startByte: Math.floor((i * total) / 32),
        endByte: Math.floor(((i + 1) * total) / 32),
        activeSpeed: 0,
      };
    });
    return { cells, doneCount: done, activeCount };
  }

  const active = isActiveStatus(status);
  const cells: ChunkCell[] = Array.from({ length: 32 }, (_, i) => ({
    index: i,
    state: i === 0 && active ? "active" : "queued",
    startByte: 0,
    endByte: 0,
    activeSpeed: 0,
  }));
  return { cells, doneCount: 0, activeCount: active ? 1 : 0 };
}

export function computeSpeedStats(
  history: number[],
  liveSpeed = 0
): { current: number; peak: number; avg: number } {
  const current = liveSpeed > 0 ? liveSpeed : history[history.length - 1] ?? 0;
  let peak = liveSpeed;
  let sum = 0;
  let count = 0;

  for (const sample of history) {
    if (sample > peak) peak = sample;
    if (sample > 0) {
      sum += sample;
      count += 1;
    }
  }

  if (count === 0 && liveSpeed > 0) {
    return { current, peak, avg: liveSpeed };
  }

  return {
    current,
    peak,
    avg: count > 0 ? sum / count : 0,
  };
}
