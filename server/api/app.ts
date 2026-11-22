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
import { checkHost, checkOrigin, securityHeaders } from "./security.ts";

const clientBuild = fileURLToPath(new URL("../../client/dist", import.meta.url));

export const createApp = (redis: Redis, events: EventStream) => {
  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeaders, checkHost);
  if (config.CORS_ORIGINS.length) app.use(cors({ origin: config.CORS_ORIGINS }));
  app.use(checkOrigin, express.json({ limit: "64kb" }));

  const jobs = createJobController(redis);
  app.use("/jobs", legacyJobRoutes(jobs));
  app.use("/api/jobs", jobRoutes(jobs));
  app.get("/api/events", events.subscribe);
  app.use("/api", systemRoutes(createSystemController(redis)));

  if (existsSync(clientBuild)) app.use(express.static(clientBuild));
  else app.get("/", (_req, res) => void res.send("TaskForge API running"));

  app.use((_req, _res, next) => next(new HttpError(404, "not_found", "Not found")));
  app.use(errorHandler);
  return app;
};
