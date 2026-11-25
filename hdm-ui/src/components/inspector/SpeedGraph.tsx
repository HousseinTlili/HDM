import { useMemo } from "react";
import { computeSpeedStats } from "../../lib/chunks";
import { formatSpeed } from "../../lib/format";

interface SpeedGraphProps {
  history: number[];
  liveSpeed?: number;
}

export function SpeedGraph({ history, liveSpeed = 0 }: SpeedGraphProps) {
  const stats = useMemo(
    () => computeSpeedStats(history, liveSpeed),
    [history, liveSpeed]
  );

  const polylinePoints = useMemo(() => {
    const width = 264;
    const height = 64;
    const padY = 6;
    const series =
      history.length > 0
        ? [...history.slice(-47), liveSpeed > 0 ? liveSpeed : history[history.length - 1] ?? 0]
        : [0, liveSpeed];
    if (series.length < 2) {
      series.unshift(series[0] ?? 0);
    }
    const maxVal = Math.max(stats.peak, ...series, 1024);
    const len = series.length;
    return series
      .map((spd, idx) => {
        const x = (idx / (len - 1)) * width;
        const ratio = Math.min(1, Math.max(0, spd / maxVal));
        const y = height - padY - ratio * (height - padY * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [history, liveSpeed, stats.peak]);

  return (
    <div className="rounded-md bg-surface border border-outline p-3 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">
          Live Speed
        </span>
        <span className="font-mono text-mono-lg tabular text-on-surface">
          {formatSpeed(stats.current)}
        </span>
      </div>

      <svg
        viewBox="0 0 264 64"
        className="w-full h-16 overflow-visible"
        aria-label="Live transfer speed graph"
      >
        <line x1="0" y1="16" x2="264" y2="16" stroke="#1C1C24" strokeWidth="1" />
        <line x1="0" y1="32" x2="264" y2="32" stroke="#1C1C24" strokeWidth="1" />
        <line x1="0" y1="48" x2="264" y2="48" stroke="#1C1C24" strokeWidth="1" />
        <polyline
          fill="none"
          stroke="#E11D2E"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="crimson-stroke-glow"
          points={polylinePoints}
        />
      </svg>

      <div className="flex items-center justify-between text-on-surface-variant">
        <span className="font-mono text-mono-sm tabular">
          Peak: {formatSpeed(stats.peak)}
        </span>
        <span className="font-mono text-mono-sm tabular">
          Avg: {formatSpeed(stats.avg)}
        </span>
      </div>
    </div>
  );
}
