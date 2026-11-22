import type { Point } from "./iso";

/** Where everything stands, in world units. */
export const WORLD = { width: 20, depth: 10.4, above: 2.2, below: 0.5 };

export const FURNACE = { x: 0.6, y: 2.7, w: 2.5, d: 3.2, h: 2.3 };
export const QUEUE = { x: 4.7, y: 2.3, w: 3.6, d: 4 };
export const COOLING = { x: 4.7, y: 7.4, w: 3.6, d: 2.3 };
export const SHIPPED = { x: 16.1, y: 0.8, w: 3.2, d: 3.6 };
export const SCRAP = { x: 16.3, y: 6.5, w: 2.8, d: 2.4 };
export const MAX_STATIONS = 6;

export const INTAKE: Point = { x: FURNACE.x + FURNACE.w - 0.1, y: FURNACE.y + FURNACE.d / 2, z: 0.5 };
export const SHIPPED_DROP: Point = { x: SHIPPED.x + 1.5, y: SHIPPED.y + 1.8, z: 0.8 };
export const SCRAP_DROP: Point = { x: SCRAP.x + 1.4, y: SCRAP.y + 1.2, z: 0.7 };

/** One column of hammers up to three workers, two columns after that. */
export const stationPosition = (index: number, total: number) => {
  if (total === 1) return { x: 11.6, y: 4.3 };
  if (total === 2) return { x: 11.6, y: [2.2, 6.6][index]! };
  const y = [1.2, 4.5, 7.8][index % 3]!;
  if (total === 3) return { x: 11.6, y };
  return { x: index < 3 ? 9.9 : 13.1, y };
};

export const queueSlot = (index: number): Point => {
  const perLayer = 24;
  const i = Math.min(index, perLayer * 6 - 1);
  return {
    x: QUEUE.x + 0.5 + (i % 4) * 0.86,
    y: QUEUE.y + 0.43 + (Math.floor(i / 4) % 6) * 0.62,
    z: 0.22 + Math.floor(i / perLayer) * 0.25,
  };
};

export const coolingSlot = (index: number): Point => {
  const perLayer = 12;
  const i = Math.min(index, perLayer * 5 - 1);
  return {
    x: COOLING.x + 0.5 + (i % 4) * 0.86,
    y: COOLING.y + 0.48 + (Math.floor(i / 4) % 3) * 0.66,
    z: 0.22 + Math.floor(i / perLayer) * 0.25,
  };
};

export const anvilSlot = (station: { x: number; y: number }, index: number): Point => ({
  x: station.x + 0.5 + (index % 3) * 0.62,
  y: station.y + 1.2 + (Math.floor(index / 3) % 2) * 0.35,
  z: 0.72 + Math.floor(index / 6) * 0.25,
});
