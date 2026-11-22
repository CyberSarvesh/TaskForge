import type { Request, Response } from "express";
import type { Redis } from "ioredis";
import { z } from "zod";
import { config } from "../config.ts";
import { query } from "../db/postgres.ts";
import { HttpError } from "../lib/errors.ts";
import { describeJobTypes } from "../jobs/registry.ts";
import { parse, submitMany } from "../services/jobService.ts";
import { describeScenarios, scenarioJobs, scenarioNames } from "../services/scenarios.ts";
import { getSnapshot } from "../services/statsService.ts";
import { requestCrash } from "../services/workerStore.ts";

export const createSystemController = (redis: Redis) => ({
  async health(_req: Request, res: Response) {
    const [postgres, cache] = await Promise.all([
      query("SELECT 1").then(() => "up", () => "down"),
      redis.ping().then(() => "up", () => "down"),
    ]);
    // Without Redis we still accept jobs safely, so that is degraded and not down.
    const status = postgres === "down" ? "down" : cache === "down" ? "degraded" : "ok";
    res.status(status === "down" ? 503 : 200).json({ status, postgres, redis: cache });
  },

  meta(_req: Request, res: Response) {
    res.json({
      demo: config.DEMO_MODE,
      leaseMs: config.LEASE_MS,
      types: describeJobTypes(),
      scenarios: config.DEMO_MODE ? describeScenarios() : [],
    });
  },

  async snapshot(_req: Request, res: Response) {
    res.json(await getSnapshot(redis));
  },

  async runScenario(req: Request, res: Response) {
    const name = parse(z.enum(scenarioNames), req.params.name, "scenario");
    const created = await submitMany(redis, scenarioJobs(name));
    res.status(202).json({ created: created.length });
  },

  async crashWorker(req: Request, res: Response) {
    const id = parse(z.uuid(), req.params.id, "worker id");
    if (!(await requestCrash(id))) throw new HttpError(404, "not_found", "No live worker with that id");
    res.status(202).json({ crashing: id });
  },
});
