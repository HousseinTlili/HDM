import { describe, expect, it } from "vitest";
import {
  computeAverageEtaSecs,
  computeAverageSpeedBps,
  formatEta,
} from "./format";

describe("average-speed ETA helpers", () => {
  it("uses session byte delta once elapsed >= 2s", () => {
    // 20 MB downloaded in 10 seconds => 2 MB/s average regardless of spiky samples
    const start = 100 * 1024 * 1024;
    const current = 120 * 1024 * 1024;
    const avg = computeAverageSpeedBps(start, current, 10_000, [
      500_000,
      10_000_000,
    ]);
    expect(avg).toBeCloseTo(2 * 1024 * 1024, 2);
  });

  it("falls back to mean of positive samples during the first 2 seconds", () => {
    const avg = computeAverageSpeedBps(0, 1000, 500, [0, 2_000_000, 4_000_000]);
    expect(avg).toBe(3_000_000);
  });

  it("computes stable ETA from remaining bytes and average speed", () => {
    // 100 MB remaining at 2 MB/s => 50s
    const eta = computeAverageEtaSecs(
      50 * 1024 * 1024,
      150 * 1024 * 1024,
      2 * 1024 * 1024
    );
    expect(eta).toBe(50);
    expect(formatEta(eta)).toBe("00:50");
  });

  it("returns null when total size or average speed is unavailable", () => {
    expect(computeAverageEtaSecs(100, null, 1000)).toBeNull();
    expect(computeAverageEtaSecs(100, 1000, 0)).toBeNull();
    expect(computeAverageEtaSecs(1000, 1000, 100)).toBe(0);
  });
});
