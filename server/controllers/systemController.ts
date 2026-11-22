import type { Request, Response } from "express";
import type { Redis } from "ioredis";
import { z } from "zod";
import { config } from "../config.ts";
import { query } from "../db/postgres.ts";
import { HttpError } from "../lib/errors.ts";
import { shareFor } from "../lib/shareFor.ts";
import { describeJobTypes } from "../jobs/registry.ts";
import { parse, submitMany } from "../services/jobService.ts";
import { publicFields } from "../services/publicDemo.ts";
import { describeScenarios, scenarioJobs, scenarioNames } from "../services/scenarios.ts";
import { getSnapshot } from "../services/statsService.ts";
import { listWorkers, requestCrash } from "../services/workerStore.ts";

const SHARE_MS = 1000;
const CRASH_COOLDOWN_MS = 15_000;

const probe = (redis: Redis) =>
  Promise.all([
    query("SELECT 1").then(() => "up", () => "down"),
    redis.ping().then(() => "up", () => "down"),
  ]);

export const createSystemController = (redis: Redis) => {
  // In public, any number of callers cost one set of queries a second.
  const sharedProbe = shareFor(SHARE_MS, () => probe(redis));
  const sharedSnapshot = shareFor(SHARE_MS, () => getSnapshot(redis));
  let lastCrash = 0;

  /** Visitors may break one worker at a time, never the whole demo. */
  const guardCrash = async () => {
    const workers = await listWorkers();
    if (Date.now() - lastCrash < CRASH_COOLDOWN_MS || workers.some((worker) => !worker.online)) {
      throw new HttpError(429, "crash_cooldown", "A worker was just killed. Wait for it to recover first.");
    }
    lastCrash = Date.now();
  };

  return {
    async health(_req: Request, res: Response) {
      const [postgres, cache] = config.PUBLIC_DEMO ? (await sharedProbe()).value : await probe(redis);
      // Without Redis we still accept jobs safely, so that is degraded and not down.
      const status = postgres === "down" ? "down" : cache === "down" ? "degraded" : "ok";
      res.status(status === "down" ? 503 : 200).json({ status, postgres, redis: cache });
    },

    meta(_req: Request, res: Response) {
      const types = describeJobTypes();
      res.json({
        demo: config.DEMO_MODE,
        publicDemo: config.PUBLIC_DEMO,
        leaseMs: config.LEASE_MS,
        types: config.PUBLIC_DEMO ? types.map((type) => ({ ...type, fields: publicFields(type.fields) })) : types,
        scenarios: config.DEMO_MODE ? describeScenarios() : [],
      });
    },

    async snapshot(_req: Request, res: Response) {
      if (!config.PUBLIC_DEMO) return void res.json(await getSnapshot(redis));
      const { value, ageMs } = await sharedSnapshot();
      res.json({ ...value, ageMs });
    },

    async runScenario(req: Request, res: Response) {
      const name = parse(z.enum(scenarioNames), req.params.name, "scenario");
      const created = await submitMany(redis, scenarioJobs(name));
      res.status(202).json({ created: created.length });
    },

    async crashWorker(req: Request, res: Response) {
      const id = parse(z.uuid(), req.params.id, "worker id");
      if (config.PUBLIC_DEMO) await guardCrash();
      if (!(await requestCrash(id))) throw new HttpError(404, "not_found", "No live worker with that id");
      res.status(202).json({ crashing: id });
    },
  };
};
