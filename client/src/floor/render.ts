import type { Camera, Faces, Point } from "./iso";
import { Pen } from "./iso";
import { COOLING, FURNACE, QUEUE, SCRAP, SHIPPED, WORLD } from "./layout";
import { INGOT } from "./palette";
import type { Palette } from "./palette";
import type { Ingot, Scene, Station } from "./scene";

const EMBER = "255,120,30";

export const renderFloor = (
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  scene: Scene,
  palette: Palette,
  now: number,
) => {
  const pen = new Pen(ctx, camera);
  const t = scene.still ? 0 : now / 1000;

  drawGround(pen, scene, palette, t);

  // Painter's algorithm: anything nearer the viewer has a larger x + y.
  const items: { depth: number; draw: () => void }[] = [
    { depth: FURNACE.x + FURNACE.y + 2.2, draw: () => drawFurnace(pen, palette, t) },
    { depth: SHIPPED.x + SHIPPED.y + 2, draw: () => drawShipped(pen, palette, scene.shipped) },
    { depth: SCRAP.x + SCRAP.y + 1.5, draw: () => drawScrap(pen, palette, scene.scrap) },
  ];
  for (const station of scene.stations) {
    items.push({ depth: station.x + station.y + 1.3, draw: () => drawStation(pen, palette, station, t) });
  }
  for (const ingot of scene.ingots.values()) {
    items.push({ depth: depthOf(ingot, scene.stations), draw: () => drawIngot(pen, palette, ingot) });
  }
  items.sort((a, b) => a.depth - b.depth);
  for (const item of items) item.draw();

  for (const { x, y, z, size, age, life, kind } of scene.particles) {
    const fade = 1 - age / life;
    if (kind === "spark") pen.dot(x, y, z, size, fade > 0.5 ? "#fff1a8" : "#ff8a1f", fade);
    else pen.dot(x, y, z, size, palette.smoke, fade * 0.28);
  }
};

const depthOf = ({ at, place, worker }: Ingot, stations: Station[]) => {
  const base = at.x + at.y + at.z * 0.9;
  if (place !== "anvil") return base;
  // Metal on an anvil must be painted after the machine it sits on.
  const station = stations.find((item) => item.worker.name === worker);
  const onIt = station && Math.abs(at.x - station.x - 1.1) < 1.2 && Math.abs(at.y - station.y - 1.2) < 0.7;
  return onIt ? Math.max(base, station.x + station.y + 1.31 + at.x * 0.001) : base;
};

const drawGround = (pen: Pen, scene: Scene, p: Palette, t: number) => {
  const { width, depth } = WORLD;
  pen.box(0, 0, -0.5, width, depth, 0.5, p.slab);
  for (let x = 1; x < width; x++) pen.line([x, 0, 0], [x, depth, 0], p.tile, 0.025);
  for (let y = 1; y < depth; y++) pen.line([0, y, 0], [width, y, 0], p.tile, 0.025);

  for (const zone of [QUEUE, COOLING, SHIPPED, SCRAP]) {
    pen.plane(zone.x - 0.2, zone.y - 0.2, 0.01, zone.w + 0.4, zone.d + 0.4, p.paint);
  }

  beltX(pen, p, FURNACE.x + FURNACE.w, QUEUE.x - 0.2, FURNACE.y + FURNACE.d / 2, t);
  if (scene.stations.length) {
    const lanes = scene.stations.map((station) => station.y + 1);
    const top = Math.min(4.3, ...lanes);
    const bottom = Math.max(4.3, ...lanes);
    beltX(pen, p, QUEUE.x + QUEUE.w + 0.2, 9, 4.3, t);
    beltY(pen, p, top, bottom, 9, t);
    beltY(pen, p, Math.min(top, 2.6), Math.max(bottom, 7.7), 15.4, t);
    for (const station of scene.stations) {
      beltX(pen, p, 9, station.x, station.y + 1, t);
      beltX(pen, p, station.x + 2.2, 15.4, station.y + 1, t);
    }
    beltX(pen, p, 15.4, SHIPPED.x, 2.6, t);
    beltX(pen, p, 15.4, SCRAP.x, 7.7, t);
  }

  for (const { x, y } of scene.stations) hazardStrip(pen, p, x, y + 1.85);
  pen.box(QUEUE.x, QUEUE.y, 0, QUEUE.w, QUEUE.d, 0.22, p.iron);
  pen.box(COOLING.x, COOLING.y, 0, COOLING.w, COOLING.d, 0.22, p.steel);

  pen.stencil("INTAKE", FURNACE.x, FURNACE.y + FURNACE.d + 1, 0.8, p.stencil);
  pen.stencil("QUEUE", QUEUE.x, QUEUE.y - 1, 0.9, p.stencil);
  pen.stencil("COOLING", 1.1, COOLING.y + 1.9, 0.8, p.stencil);
  pen.stencil("SHIPPED", SHIPPED.x, SHIPPED.y + SHIPPED.d + 0.82, 0.62, p.stencil);
  pen.stencil("SCRAP", SCRAP.x, SCRAP.y + SCRAP.d + 1.1, 0.8, p.stencil);
};

const beltX = (pen: Pen, p: Palette, from: number, to: number, y: number, t: number) => {
  if (to <= from) return;
  pen.plane(from, y - 0.27, 0.03, to - from, 0.54, p.belt);
  for (let x = from + ((t * 0.8) % 0.5); x < to; x += 0.5) {
    pen.line([x, y - 0.2, 0.04], [x, y + 0.2, 0.04], p.beltMark, 0.04);
  }
};

const beltY = (pen: Pen, p: Palette, from: number, to: number, x: number, t: number) => {
  pen.plane(x - 0.27, from - 0.27, 0.025, 0.54, to - from + 0.54, p.belt);
  for (let y = from + ((t * 0.8) % 0.5); y < to; y += 0.5) {
    pen.line([x - 0.2, y, 0.035], [x + 0.2, y, 0.035], p.beltMark, 0.04);
  }
};

const hazardStrip = (pen: Pen, p: Palette, x: number, y: number) => {
  pen.plane(x, y, 0.04, 2.2, 0.26, p.hazard);
  for (let i = 0; i < 6; i++) {
    const a = x + i * 0.36;
    pen.polygon([[a, y + 0.26, 0.05], [a + 0.16, y + 0.26, 0.05], [a + 0.32, y, 0.05], [a + 0.16, y, 0.05]], p.belt);
  }
};

const drawFurnace = (pen: Pen, p: Palette, t: number) => {
  const { x, y, w, d, h } = FURNACE;
  pen.box(x, y, 0, w, d, 0.35, p.iron);
  pen.box(x + 0.12, y + 0.12, 0.35, w - 0.24, d - 0.24, h - 0.35, p.machine);
  pen.box(x + 0.3, y + 0.4, h, 0.8, 0.8, 1.2, p.iron);
  pen.box(x + 0.22, y + 0.32, h + 1.1, 0.96, 0.96, 0.16, p.steel);
  pen.box(x + 1.35, y + 1.7, h, 0.7, 0.95, 0.25, p.steel);
  for (let i = 0; i < 4; i++) {
    const vent = x + 0.4 + i * 0.5;
    pen.line([vent, y + d - 0.11, 0.7], [vent, y + d - 0.11, 1.6], p.iron[2], 0.08);
  }

  const face = x + w - 0.11;
  const middle = y + d / 2;
  pen.polygon(arch(face, middle, 0.86, 1.6), p.iron[2]);
  pen.polygon(arch(face + 0.01, middle, 0.66, 1.35), "#e8590c");
  pen.polygon(arch(face + 0.02, middle, 0.4, 0.95 + Math.sin(t * 7) * 0.08), "#ffc04d");
  pen.glow(face + 0.3, middle, 0.8, 1.9, EMBER, p.glow * (1 + Math.sin(t * 5) * 0.15));
};

/** An arched opening on a face that looks along +x. */
const arch = (x: number, middle: number, radius: number, height: number) => {
  const points: [number, number, number][] = [[x, middle + radius, 0.35]];
  for (let i = 0; i <= 10; i++) {
    const angle = (i / 10) * Math.PI;
    points.push([x, middle + Math.cos(angle) * radius, height - radius * 0.6 + Math.sin(angle) * radius * 0.6]);
  }
  points.push([x, middle - radius, 0.35]);
  return points;
};

const drawStation = (pen: Pen, p: Palette, { x, y, worker, stroke, busy }: Station, t: number) => {
  const body: Faces = worker.online ? p.machine : p.dead;
  pen.box(x, y, 0, 2.2, 1.75, 0.3, p.iron);
  pen.box(x + 0.1, y + 0.05, 0.3, 0.38, 0.6, 1.85, body);
  pen.box(x + 1.72, y + 0.05, 0.3, 0.38, 0.6, 1.85, body);

  const head = 1.55 - stroke * 0.62;
  pen.box(x + 0.96, y + 0.25, head + 0.4, 0.28, 0.3, Math.max(0.05, 1.8 - head), p.steel);
  pen.box(x + 0.65, y + 0.2, head, 0.9, 0.65, 0.42, p.iron);
  pen.box(x, y, 2.15, 2.2, 0.72, 0.36, body);

  const spin = busy && worker.online ? t * 5 : 0;
  for (let i = 0; i < 3; i++) {
    const angle = spin + (i * Math.PI) / 3;
    const dy = Math.cos(angle) * 0.36;
    const dz = Math.sin(angle) * 0.36;
    pen.line([x + 2.24, y + 0.36 - dy, 1.65 - dz], [x + 2.24, y + 0.36 + dy, 1.65 + dz], p.steel[1], 0.07);
  }
  pen.box(x + 0.22, y + 0.95, 0.3, 1.76, 0.72, 0.42, p.steel);

  // One lamp per concurrency slot.
  const lamps = Math.min(worker.concurrency, 8);
  for (let i = 0; i < lamps; i++) {
    const color = !worker.online ? "#e03131" : i < busy ? "#ffc04d" : p.belt;
    pen.dot(x + 1.1 + (i - (lamps - 1) / 2) * 0.24, y + 0.73, 2.33, 0.075, color);
  }
  if (!worker.online) pen.glow(x + 1.1, y + 0.7, 2.33, 1.1, "224,49,49", 0.4 + Math.sin(t * 9) * 0.2);
  else if (busy) pen.glow(x + 1.1, y + 1.3, 0.9, 1.5, EMBER, p.glow);
};

const drawShipped = (pen: Pen, p: Palette, total: number) => {
  const { x, y, w, d } = SHIPPED;
  for (let i = 0; i < 3; i++) pen.box(x + i * (w / 2 - 0.2), y, 0, 0.4, d, 0.16, p.wood);
  for (let i = 0; i < 5; i++) pen.box(x, y + i * (d / 5), 0.16, w, d / 5 - 0.14, 0.1, p.wood);
  const shown = Math.min(total, 60);
  for (let i = 0; i < shown; i++) {
    const row = Math.floor(i / 3) % 5;
    const at: Point = { x: x + 0.6 + (i % 3), y: y + 0.4 + row * 0.7, z: 0.26 + Math.floor(i / 15) * 0.31 };
    pen.ingot(at.x, at.y, at.z, 1.2, INGOT.shipped);
  }
};

const drawScrap = (pen: Pen, p: Palette, total: number) => {
  const { x, y, w, d } = SCRAP;
  pen.box(x, y, 0, w, d, 0.12, p.iron);
  pen.box(x, y, 0.12, 0.16, d, 0.8, p.iron);
  pen.box(x, y, 0.12, w, 0.16, 0.8, p.iron);
  const shown = Math.min(total, 40);
  for (let i = 0; i < shown; i++) {
    // Scattered, but deterministically, so the heap does not shimmer.
    const px = x + 0.55 + ((i * 0.618) % 1) * (w - 1);
    const py = y + 0.45 + ((i * 0.377) % 1) * (d - 0.8);
    pen.ingot(px, py, 0.12 + Math.floor(i / 10) * 0.18, 0.95, INGOT.scrap);
  }
  pen.box(x + w - 0.16, y, 0.12, 0.16, d, 0.34, p.iron);
  pen.box(x, y + d - 0.16, 0.12, w, 0.16, 0.34, p.iron);
};

const drawIngot = (pen: Pen, p: Palette, { at, place, priority }: Ingot) => {
  const faces =
    place === "cooling" ? INGOT.cooling
      : place === "shipped" ? INGOT.shipped
        : place === "scrap" ? INGOT.scrap
          : INGOT[priority];
  if (at.z > 0.9 && place !== "anvil") pen.glow(at.x, at.y, at.z, 0.7, EMBER, p.glow * 0.6);
  pen.ingot(at.x, at.y, at.z, place === "anvil" ? 0.85 : 1, faces);
};
