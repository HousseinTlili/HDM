import { describe, expect, it } from "vitest";
import { assessModelFit, parseSizeLabelToBytes } from "./hardware";
import type { SystemHardwareInfo } from "./types";

const GB = 1024 ** 3;

describe("hardware VRAM / RAM fit checker", () => {
  it("parses size labels into bytes", () => {
    expect(parseSizeLabelToBytes("4.5GB")).toBe(Math.round(4.5 * GB));
    expect(parseSizeLabelToBytes("512 MB")).toBe(512 * 1024 ** 2);
    expect(parseSizeLabelToBytes("invalid")).toBeNull();
  });

  it("classifies VRAM, GPU+RAM split, and too-large models accurately", () => {
    const hw: SystemHardwareInfo = {
      totalRamBytes: 16 * GB,
      availableRamBytes: 12 * GB,
      gpuName: "RTX 4070",
      gpuVramBytes: 12 * GB,
      vramSource: "nvidia-smi",
    };

    expect(assessModelFit(8 * GB, hw)?.tone).toBe("vram");
    expect(assessModelFit(14 * GB, hw)?.tone).toBe("ram");
    expect(assessModelFit(40 * GB, hw)?.tone).toBe("tight");
  });
});
