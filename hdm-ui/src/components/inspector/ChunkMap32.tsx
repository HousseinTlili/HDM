import { useMemo } from "react";
import { normalizeSegmentsTo32 } from "../../lib/chunks";
import type { ChunkCell } from "../../lib/chunks";
import { formatBytes, formatSpeed } from "../../lib/format";
import type { SegmentInfo, Status } from "../../lib/types";

interface ChunkMap32Props {
  segments: SegmentInfo[];
  totalSize: number | null | undefined;
  status: Status;
  downloaded: number;
}

function cellClasses(state: ChunkCell["state"]): string {
  switch (state) {
    case "done":
      return "bg-on-surface-variant/50";
    case "active":
      return "bg-primary";
    case "failed":
      return "bg-status-warning";
    case "queued":
      return "bg-surface-container-high border border-outline";
  }
}

function cellTooltip(cell: ChunkCell): string {
  const num = cell.index + 1;
  const label =
    cell.state === "done"
      ? "Complete"
      : cell.state === "active"
      ? "Active Thread"
      : cell.state === "failed"
      ? "Retrying"
      : "Pending";
  const range =
    cell.endByte > cell.startByte
      ? ` (${formatBytes(cell.startByte)} - ${formatBytes(cell.endByte)})`
      : "";
  const speed =
    cell.state === "active" && cell.activeSpeed > 0
      ? ` • ${formatSpeed(cell.activeSpeed)}`
      : "";
  return `Chunk ${num}: ${label}${range}${speed}`;
}

export function ChunkMap32({
  segments,
  totalSize,
  status,
  downloaded,
}: ChunkMap32Props) {
  const { cells, doneCount } = useMemo(
    () => normalizeSegmentsTo32(segments, totalSize, status, downloaded),
    [segments, totalSize, status, downloaded]
  );

  return (
    <div className="rounded-md bg-surface border border-outline p-3 flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
          32-Segment Chunk Map
        </span>
        <span className="font-mono text-mono-sm tabular text-on-surface">
          {doneCount} / 32
        </span>
      </div>

      <div
        className="grid grid-cols-8 gap-1.5"
        aria-label="32 segment chunk map"
      >
        {cells.map((cell) => (
          <span
            key={cell.index}
            title={cellTooltip(cell)}
            className={`h-3 rounded-sm transition-colors duration-state-change ease-state-change ${cellClasses(
              cell.state
            )}`}
          />
        ))}
      </div>

      <div className="flex items-center gap-4 pt-1 text-on-surface-variant">
        <span className="inline-flex items-center gap-1.5 font-label text-label-sm">
          <span className="w-2 h-2 rounded-sm bg-primary" aria-hidden="true" />
          Active
        </span>
        <span className="inline-flex items-center gap-1.5 font-label text-label-sm">
          <span
            className="w-2 h-2 rounded-sm bg-on-surface-variant/50"
            aria-hidden="true"
          />
          Done
        </span>
        <span className="inline-flex items-center gap-1.5 font-label text-label-sm">
          <span
            className="w-2 h-2 rounded-sm bg-surface-container-high border border-outline"
            aria-hidden="true"
          />
          Queued
        </span>
      </div>
    </div>
  );
}
