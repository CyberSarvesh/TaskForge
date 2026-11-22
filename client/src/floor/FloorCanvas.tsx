import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { useLive } from "../lib/live";
import { openJob } from "../lib/router";
import type { Theme } from "../lib/theme";
import type { Worker } from "../lib/types";
import { fit, project } from "./iso";
import type { Camera } from "./iso";
import { MAX_STATIONS, WORLD, stationPosition } from "./layout";
import { PALETTES } from "./palette";
import { renderFloor } from "./render";
import { Scene } from "./scene";

interface Props {
  theme: Theme;
  onCrash: ((worker: Worker) => void) | null;
}

export function FloorCanvas({ theme, onCrash }: Props) {
  const { snapshot, subscribe } = useLive();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scene] = useState(() => new Scene());
  const [camera, setCamera] = useState<Camera | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const paletteRef = useRef(PALETTES[theme]);
  paletteRef.current = PALETTES[theme];

  useEffect(() => {
    if (snapshot) scene.applySnapshot(snapshot, performance.now());
  }, [scene, snapshot]);

  useEffect(() => subscribe((event) => scene.applyEvent(event, performance.now())), [scene, subscribe]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let ratio = 1;

    const resize = new ResizeObserver(() => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      ratio = Math.min(devicePixelRatio, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const pad = width < 700 ? 4 : 20;
      const next = fit(WORLD, { left: pad, top: pad, width: width - pad * 2, height: height - pad * 2 });
      cameraRef.current = next;
      setCamera(next);
    });
    resize.observe(canvas);

    // Canvas text does not trigger a font download by itself.
    void document.fonts.load('800 40px "Big Shoulders Variable"');

    let last = performance.now();
    let frame = requestAnimationFrame(function draw() {
      const now = performance.now();
      scene.still = motion.matches;
      scene.step(now, Math.min(0.05, (now - last) / 1000));
      last = now;
      if (cameraRef.current) {
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, width, height);
        renderFloor(ctx, cameraRef.current, scene, paletteRef.current, now);
      }
      frame = requestAnimationFrame(draw);
    });

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
    };
  }, [scene]);

  const ingotAt = (event: PointerEvent<HTMLCanvasElement>) => {
    const view = cameraRef.current;
    if (!view) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    let nearest: string | null = null;
    let best = Math.max(12, view.scale * 0.45);
    for (const { id, at } of scene.ingots.values()) {
      const point = project(view, at.x, at.y, at.z + 0.13);
      const distance = Math.hypot(point.x - (event.clientX - bounds.left), point.y - (event.clientY - bounds.top));
      if (distance < best) {
        best = distance;
        nearest = id;
      }
    }
    return nearest;
  };

  const workers = [...(snapshot?.workers ?? [])]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .slice(0, MAX_STATIONS);

  return (
    <div className="floor-canvas">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Factory floor showing every live job moving from intake, through the queue and workers, to shipped or scrap. The Jobs page has the same information as a table."
        onPointerMove={(event) => {
          event.currentTarget.style.cursor = ingotAt(event) ? "pointer" : "";
        }}
        onPointerUp={(event) => {
          const id = ingotAt(event);
          if (id) openJob(id);
        }}
      />
      {camera &&
        workers.map((worker, index) => {
          const station = stationPosition(index, workers.length);
          const at = project(camera, station.x + 1.1, station.y + 0.35, 2.75);
          return (
            <div
              key={worker.name}
              className={`worker-tag ${worker.online ? "" : "offline"}`}
              style={{ left: at.x, top: at.y }}
            >
              <span>{worker.name}</span>
              {!worker.online && <b>down</b>}
              {worker.online && onCrash && (
                <button onClick={() => onCrash(worker)} aria-label={`Kill worker ${worker.name}`}>Kill</button>
              )}
            </div>
          );
        })}
    </div>
  );
}
