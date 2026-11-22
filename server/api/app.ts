import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import type { Redis } from "ioredis";
import { config } from "../config.ts";
import { createJobController } from "../controllers/jobController.ts";
import { createSystemController } from "../controllers/systemController.ts";
import { HttpError } from "../lib/errors.ts";
import { jobRoutes, legacyJobRoutes } from "../routes/jobs.ts";
import { systemRoutes } from "../routes/system.ts";
import type { EventStream } from "../services/eventStream.ts";
import { errorHandler } from "./errorHandler.ts";
import { limitLookups, limitRequests } from "./limits.ts";
import { checkHost, checkOrigin, securityHeaders } from "./security.ts";

const clientBuild = fileURLToPath(new URL("../../client/dist", import.meta.url));

export const createApp = (redis: Redis, events: EventStream) => {
  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeaders);

  const system = createSystemController(redis);
  // Before the host check and the limits: platforms probe it with their own Host, and restart on failure.
  app.get("/api/health", system.health);

  app.use(checkHost);
  if (config.PUBLIC_DEMO) {
    app.use(limitRequests());
    app.use(["/jobs", "/api/jobs"], limitLookups());
  }
  if (config.CORS_ORIGINS.length) app.use(cors({ origin: config.CORS_ORIGINS }));
  app.use(checkOrigin, express.json({ limit: config.PUBLIC_DEMO ? "8kb" : "64kb" }));

  const jobs = createJobController(redis);
  app.use("/jobs", legacyJobRoutes(jobs));
  app.use("/api/jobs", jobRoutes(jobs));
  app.get("/api/events", events.subscribe);
  app.use("/api", systemRoutes(system));

  if (existsSync(clientBuild)) app.use(express.static(clientBuild));
  else app.get("/", (_req, res) => void res.send("TaskForge API running"));

  app.use((_req, _res, next) => next(new HttpError(404, "not_found", "Not found")));
  app.use(errorHandler);
  return app;
};
