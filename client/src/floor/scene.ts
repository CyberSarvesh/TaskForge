import type { LiveEvent, Priority, Snapshot, Worker } from "../lib/types";
import type { Point } from "./iso";
import {
  FURNACE, INTAKE, MAX_STATIONS, SCRAP_DROP, SHIPPED_DROP,
  anvilSlot, coolingSlot, queueSlot, stationPosition,
} from "./layout";

export type Place = "queue" | "cooling" | "anvil" | "shipped" | "scrap";

export interface Ingot {
  id: string;
  priority: Priority;
  place: Place;
  worker: string | null;
  order: number;
  at: Point;
  from: Point;
  to: Point;
  moveStart: number;
  moveMs: number;
  /** When an event last moved it. Snapshots older than this are ignored for this ingot. */
  touched: number;
}

export interface Station {
  worker: Worker;
  x: number;
  y: number;
  busy: number;
  /** 0 is raised, 1 is striking. */
  stroke: number;
  struck: boolean;
}

export interface Particle extends Point {
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  kind: "spark" | "smoke";
}

const MAX_INGOTS = 260;
const MAX_PARTICLES = 420;
const HEAT: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

const isExiting = (ingot: Ingot) => ingot.place === "shipped" || ingot.place === "scrap";
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * The model behind the floor. It knows nothing about canvas or React: snapshots and events go in,
 * positions come out. Nothing here is invented, so an ingot exists only if the job does.
 */
export class Scene {
  ingots = new Map<string, Ingot>();
  stations: Station[] = [];
  particles: Particle[] = [];
  shipped = 0;
  scrap = 0;
  still = false;

  #finished = new Map<string, number>();
  #order = 0;
  #dirty = true;
  #smokeClock = 0;

  applySnapshot(snapshot: Snapshot, now: number) {
    const asked = snapshot.requestedAt;
    this.shipped = snapshot.counts.completed;
    this.scrap = snapshot.counts.failed + snapshot.counts.cancelled;
    this.#setWorkers(snapshot.workers);

    const seen = new Set<string>();
    for (const job of snapshot.floor) {
      seen.add(job.id);
      const finishedAt = this.#finished.get(job.id);
      if (finishedAt !== undefined && finishedAt >= asked) continue;

      const place: Place = job.state === "processing" ? "anvil" : job.state === "scheduled" ? "cooling" : "queue";
      const existing = this.ingots.get(job.id);
      if (existing && existing.touched > asked) continue;
      if (existing) this.#move(existing, place, job.worker);
      else this.#add(job.id, job.priority, place, job.worker, now);
    }

    for (const ingot of this.ingots.values()) {
      if (!seen.has(ingot.id) && ingot.touched <= asked && !isExiting(ingot)) {
        this.ingots.delete(ingot.id);
        this.#dirty = true;
      }
    }
    for (const [id, at] of this.#finished) {
      if (now - at > 30_000) this.#finished.delete(id);
    }
  }

  applyEvent(event: LiveEvent, now: number) {
    const place = placeAfter(event);
    const exiting = place === "shipped" || place === "scrap";
    if (exiting) this.#finished.set(event.jobId, now);
    else this.#finished.delete(event.jobId);

    let ingot = this.ingots.get(event.jobId);
    // Something we never drew has just finished, so there is nothing to animate.
    if (!ingot && exiting) return;
    ingot ??= this.#add(event.jobId, event.priority, "queue", null, now, INTAKE);
    if (!ingot) return;

    ingot.touched = now;
    this.#move(ingot, place, event.worker);
  }

  #add(id: string, priority: Priority, place: Place, worker: string | null, now: number, start?: Point) {
    if (this.ingots.size >= MAX_INGOTS) return undefined;
    const origin = start ?? INTAKE;
    const ingot: Ingot = {
      id, priority, place, worker,
      order: this.#order++,
      at: { ...origin }, from: { ...origin }, to: { ...origin },
      moveStart: now, moveMs: 0, touched: start ? now : 0,
    };
    this.ingots.set(id, ingot);
    this.#dirty = true;
    return ingot;
  }

  #move(ingot: Ingot, place: Place, worker: string | null) {
    if (ingot.place === place && (place !== "anvil" || ingot.worker === worker)) return;
    ingot.place = place;
    ingot.worker = worker;
    this.#dirty = true;
  }

  #setWorkers(workers: Worker[]) {
    const shown = [...workers]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .slice(0, MAX_STATIONS);
    const previous = new Map(this.stations.map((station) => [station.worker.name, station]));
    this.stations = shown.map((worker, index) => {
      const position = stationPosition(index, shown.length);
      const old = previous.get(worker.name);
      if (!old || old.x !== position.x || old.y !== position.y) this.#dirty = true;
      return { busy: 0, stroke: 0, struck: false, ...old, ...position, worker };
    });
    if (previous.size !== shown.length) this.#dirty = true;
  }

  #retarget(now: number) {
    const groups: Record<Place, Ingot[]> = { queue: [], cooling: [], anvil: [], shipped: [], scrap: [] };
    for (const ingot of this.ingots.values()) groups[ingot.place].push(ingot);

    groups.queue
      .sort((a, b) => HEAT[a.priority] - HEAT[b.priority] || a.order - b.order)
      .forEach((ingot, index) => this.#aim(ingot, queueSlot(index), now));
    groups.cooling.forEach((ingot, index) => this.#aim(ingot, coolingSlot(index), now));

    for (const station of this.stations) station.busy = 0;
    const byName = new Map(this.stations.map((station) => [station.worker.name, station]));
    for (const ingot of groups.anvil) {
      const station = byName.get(ingot.worker ?? "");
      this.#aim(ingot, station ? anvilSlot(station, station.busy++) : { x: 9, y: 4.5, z: 0.4 }, now);
    }

    for (const ingot of groups.shipped) this.#aim(ingot, SHIPPED_DROP, now);
    for (const ingot of groups.scrap) this.#aim(ingot, SCRAP_DROP, now);
  }

  #aim(ingot: Ingot, to: Point, now: number) {
    if (ingot.to.x === to.x && ingot.to.y === to.y && ingot.to.z === to.z) return;
    const distance = Math.hypot(to.x - ingot.at.x, to.y - ingot.at.y);
    ingot.from = { ...ingot.at };
    ingot.to = to;
    ingot.moveStart = now;
    ingot.moveMs = this.still ? 0 : Math.min(1000, 280 + distance * 85);
  }

  step(now: number, seconds: number) {
    if (this.#dirty) {
      this.#retarget(now);
      this.#dirty = false;
    }

    for (const ingot of this.ingots.values()) {
      const t = ingot.moveMs ? Math.min(1, (now - ingot.moveStart) / ingot.moveMs) : 1;
      const k = ease(t);
      const { from, to, at } = ingot;
      const hop = Math.min(1.5, Math.hypot(to.x - from.x, to.y - from.y) * 0.24);
      at.x = from.x + (to.x - from.x) * k;
      at.y = from.y + (to.y - from.y) * k;
      at.z = from.z + (to.z - from.z) * k + Math.sin(Math.PI * t) * hop;

      if (t === 1 && isExiting(ingot)) {
        if (!this.still) this.#burst(at, ingot.place === "scrap" ? "smoke" : "spark", 6);
        this.ingots.delete(ingot.id);
      }
    }

    if (this.still) {
      this.particles.length = 0;
      for (const station of this.stations) station.stroke = 0;
      return;
    }
    this.#animateMachines(now, seconds);
    this.#animateParticles(seconds);
  }

  #animateMachines(now: number, seconds: number) {
    this.stations.forEach((station, index) => {
      if (!station.worker.online) {
        station.stroke = 1;
        if (Math.random() < seconds * 7) {
          this.#burst({ x: station.x + 1.1, y: station.y + 0.5, z: 1.7 }, "smoke", 1);
        }
        return;
      }
      const phase = station.busy ? (now / 720 + index * 0.37) % 1 : 0;
      // A slow lift and a fast drop, which is what makes it read as heavy.
      station.stroke = phase < 0.72 ? 0 : phase < 0.82 ? ((phase - 0.72) / 0.1) ** 2 : 1 - (phase - 0.82) / 0.18;
      const striking = station.stroke > 0.8;
      if (striking && !station.struck) {
        this.#burst({ x: station.x + 1.1, y: station.y + 1.2, z: 1 }, "spark", 12);
      }
      station.struck = striking;
    });

    this.#smokeClock += seconds;
    if (this.#smokeClock > 0.28) {
      this.#smokeClock = 0;
      this.#burst({ x: FURNACE.x + 0.7, y: FURNACE.y + 0.8, z: FURNACE.h + 1.3 }, "smoke", 1);
    }
  }

  #burst(origin: Point, kind: Particle["kind"], amount: number) {
    const spark = kind === "spark";
    for (let i = 0; i < amount && this.particles.length < MAX_PARTICLES; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = spark ? 1 + Math.random() * 2 : 0.15;
      this.particles.push({
        ...origin, kind,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        vz: spark ? 1 + Math.random() * 2.2 : 0.65 + Math.random() * 0.3,
        age: 0,
        life: spark ? 0.3 + Math.random() * 0.35 : 1.5 + Math.random(),
        size: spark ? 0.035 : 0.16 + Math.random() * 0.12,
      });
    }
  }

  #animateParticles(seconds: number) {
    this.particles = this.particles.filter((particle) => (particle.age += seconds) < particle.life);
    for (const particle of this.particles) {
      particle.x += particle.vx * seconds;
      particle.y += particle.vy * seconds;
      particle.z = Math.max(0, particle.z + particle.vz * seconds);
      if (particle.kind === "spark") particle.vz -= 9 * seconds;
      else particle.size += seconds * 0.16;
    }
  }
}

const placeAfter = ({ kind }: LiveEvent): Place => {
  switch (kind) {
    case "started": return "anvil";
    case "completed": return "shipped";
    case "failed":
    case "cancelled": return "scrap";
    case "scheduled":
    case "retrying": return "cooling";
    case "created":
    case "requeued":
    case "recovered":
    case "released": return "queue";
  }
};
