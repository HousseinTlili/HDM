import { describe, expect, it } from "vitest";
import { computeSpeedStats, normalizeSegmentsTo32 } from "./chunks";
import type { SegmentInfo } from "./types";

describe("32-segment chunk normalizer", () => {
  it("marks all 32 chunks complete for completed items", () => {
    const res = normalizeSegmentsTo32([], 3200, "completed", 3200);
    expect(res.cells).toHaveLength(32);
    expect(res.doneCount).toBe(32);
    expect(res.activeCount).toBe(0);
    expect(res.cells.every((c) => c.state === "done")).toBe(true);
  });

  it("normalizes variable work-stealing byte segments across 32 buckets", () => {
    const total = 32_000;
    const segments: SegmentInfo[] = [
      // First quarter completely done (buckets 0..7)
      { start: 0, pos: 8000, end: 8000, speed: 0, state: "done" },
      // Second quarter halfway done & actively downloading in bucket 12 (buckets 8..15)
      { start: 8000, pos: 12000, end: 16000, speed: 4_000_000, state: "active" },
      // Third quarter retrying
      { start: 16000, pos: 16000, end: 24000, speed: 0, state: "retrying" },
      // Final quarter idle / queued
      { start: 24000, pos: 24000, end: 32000, speed: 0, state: "idle" },
    ];

    const res = normalizeSegmentsTo32(segments, total, "downloading", 12000);
    expect(res.cells).toHaveLength(32);
    expect(res.doneCount).toBe(12); // buckets 0..11 completed
    expect(res.cells[0].state).toBe("done");
    expect(res.cells[11].state).toBe("done");
    expect(res.cells[12].state).toBe("active");
    expect(res.cells[12].activeSpeed).toBe(4_000_000);
    expect(res.cells[16].state).toBe("failed");
    expect(res.cells[24].state).toBe("queued");
  });

  it("falls back gracefully when segments array is empty", () => {
    const res = normalizeSegmentsTo32([], 3200, "downloading", 1600);
    expect(res.doneCount).toBe(16);
    expect(res.cells[15].state).toBe("done");
    expect(res.cells[16].state).toBe("active");
    expect(res.cells[17].state).toBe("queued");
  });

  it("handles unknown size without crashing", () => {
    const res = normalizeSegmentsTo32([], null, "connecting", 0);
    expect(res.cells).toHaveLength(32);
    expect(res.cells[0].state).toBe("active");
    expect(res.cells[1].state).toBe("queued");
  });

  it("computes peak, current, and average speed stats", () => {
    const stats = computeSpeedStats([0, 10_000, 20_000, 30_000], 25_000);
    expect(stats.current).toBe(25_000);
    expect(stats.peak).toBe(30_000);
    expect(stats.avg).toBe(20_000);

    const idleStats = computeSpeedStats([0, 0], 0);
    expect(idleStats).toEqual({ current: 0, peak: 0, avg: 0 });
  });
});
