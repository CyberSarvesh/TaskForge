import { useEffect, useRef, useState } from "react";
import { time } from "../lib/format";
import type { Snapshot } from "../lib/types";

const HEIGHT = 270;
const PAD = { top: 20, right: 92, bottom: 30, left: 36 };
const SERIES = [
  { key: "completed", label: "Completed" },
  { key: "errors", label: "Errors" },
] as const;

const niceCeiling = (value: number) => {
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((s) => s * 4 >= value) ?? value / 4;
  return step * 4;
};

export function ThroughputChart({ series }: { series: Snapshot["series"] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, []);

  // The newest bucket is still filling up and would always look like a drop.
  const points = series.slice(0, -1);
  const max = niceCeiling(Math.max(1, ...points.flatMap((point) => [point.completed, point.errors])));
  const plotWidth = Math.max(1, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (index / Math.max(1, points.length - 1)) * plotWidth;
  const y = (value: number) => PAD.top + plotHeight * (1 - value / max);

  const last = points.at(-1);
  const active = hovered === null ? undefined : points[hovered];

  // End labels are nudged apart when the lines finish close together.
  let completedLabel = y(last?.completed ?? 0);
  let errorsLabel = y(last?.errors ?? 0);
  if (Math.abs(completedLabel - errorsLabel) < 16) {
    const middle = Math.min(y(0) - 8, (completedLabel + errorsLabel) / 2);
    const completedOnTop = (last?.completed ?? 0) >= (last?.errors ?? 0);
    completedLabel = middle + (completedOnTop ? -8 : 8);
    errorsLabel = middle + (completedOnTop ? 8 : -8);
  }

  const moveTo = (index: number) => setHovered(Math.min(points.length - 1, Math.max(0, index)));

  return (
    <div className="chart" ref={ref}>
      <div className="legend">
        {SERIES.map(({ key, label }) => <span key={key} className={key}>{label}</span>)}
      </div>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          tabIndex={0}
          role="img"
          aria-label="Completed jobs and errors per 5 seconds. Use the arrow keys to read values."
          onPointerMove={(event) => {
            const offset = event.clientX - event.currentTarget.getBoundingClientRect().left - PAD.left;
            moveTo(Math.round((offset / plotWidth) * (points.length - 1)));
          }}
          onPointerLeave={() => setHovered(null)}
          onBlur={() => setHovered(null)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            moveTo((hovered ?? points.length) + (event.key === "ArrowLeft" ? -1 : 1));
          }}
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <line className="grid" x1={PAD.left} x2={PAD.left + plotWidth} y1={y((max * i) / 4)} y2={y((max * i) / 4)} />
              <text x={PAD.left - 8} y={y((max * i) / 4) + 4} textAnchor="end">{(max * i) / 4}</text>
            </g>
          ))}
          {points.length > 1 &&
            [0, Math.floor((points.length - 1) / 2), points.length - 1].map((index, i) => (
              <text key={i} x={x(index)} y={HEIGHT - 6} textAnchor={(["start", "middle", "end"] as const)[i]}>
                {time(points[index]!.t)}
              </text>
            ))}
          {active && <line className="crosshair" x1={x(hovered!)} x2={x(hovered!)} y1={PAD.top} y2={y(0)} />}
          {SERIES.map(({ key, label }) => (
            <g key={key} className={key}>
              <polyline points={points.map((point, index) => `${x(index)},${y(point[key])}`).join(" ")} />
              {active && <circle cx={x(hovered!)} cy={y(active[key])} r="5" />}
              {last && (
                <text x={PAD.left + plotWidth + 10} y={(key === "completed" ? completedLabel : errorsLabel) + 4}>
                  {label}
                </text>
              )}
            </g>
          ))}
        </svg>
      )}
      {active && (
        <div className="tooltip" style={{ left: Math.min(Math.max(70, x(hovered!)), width - 70) }}>
          <time>{time(active.t)}</time>
          <span className="completed">{active.completed} completed</span>
          <span className="errors">{active.errors} errors</span>
        </div>
      )}
    </div>
  );
}
