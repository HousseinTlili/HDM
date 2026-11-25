import type { SystemHardwareInfo } from "./types";

export interface ModelFitAssessment {
  label: string;
  tone: "vram" | "ram" | "tight";
  detail: string;
}

/** Parse size strings like "4.7GB", "850MB", "12.5 GB" into bytes. */
export function parseSizeLabelToBytes(label?: string | null): number | null {
  if (!label) return null;
  const match = label.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(TB|GB|MB|KB|B)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  switch (match[2].toUpperCase()) {
    case "TB":
      return Math.round(value * 1024 ** 4);
    case "GB":
      return Math.round(value * 1024 ** 3);
    case "MB":
      return Math.round(value * 1024 ** 2);
    case "KB":
      return Math.round(value * 1024);
    default:
      return Math.round(value);
  }
}

/**
 * Assess whether a GGUF model of `modelBytes` fits in GPU VRAM or System RAM.
 * Includes ~15% overhead for KV cache and runtime allocations.
 */
export function assessModelFit(
  modelBytes: number,
  hw: SystemHardwareInfo | null
): ModelFitAssessment | null {
  if (!hw || modelBytes <= 0) return null;
  const needed = modelBytes * 1.15;
  const vram = hw.gpuVramBytes ?? 0;
  const totalRam = hw.totalRamBytes;
  const usableRam = totalRam * 0.85;

  if (vram > 0 && needed <= vram) {
    const gb = (vram / 1024 ** 3).toFixed(0);
    return {
      label: `Fits ${gb}GB VRAM`,
      tone: "vram",
      detail: `Full GPU acceleration on ${hw.gpuName ?? "GPU"}`,
    };
  }

  if (vram > 0 && needed <= vram + usableRam * 0.75) {
    return {
      label: "GPU + RAM Split",
      tone: "ram",
      detail: `Partial GPU offload + system RAM (${(totalRam / 1024 ** 3).toFixed(0)} GB total)`,
    };
  }

  if (totalRam > 0 && needed <= usableRam) {
    return {
      label: "CPU / RAM Fit",
      tone: "ram",
      detail: `Fits in ${(totalRam / 1024 ** 3).toFixed(0)} GB system RAM`,
    };
  }

  return {
    label: "Too Large",
    tone: "tight",
    detail: `Exceeds detected VRAM/RAM (${(totalRam / 1024 ** 3).toFixed(0)} GB RAM)`,
  };
}

export function fitBadgeClasses(tone: ModelFitAssessment["tone"]): string {
  switch (tone) {
    case "vram":
      return "bg-status-connected-tint border border-status-connected/30 text-status-connected";
    case "ram":
      return "bg-status-warning-tint border border-status-warning/30 text-status-warning";
    case "tight":
      return "bg-primary-tint border border-primary/40 text-on-primary-badge";
  }
}
