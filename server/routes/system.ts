import express from "express";
import { config } from "../config.ts";
import type { createSystemController } from "../controllers/systemController.ts";

export const systemRoutes = (controller: ReturnType<typeof createSystemController>) => {
  const router = express.Router();
  router.get("/meta", controller.meta);
  router.get("/snapshot", controller.snapshot);
  if (config.DEMO_MODE) {
    router.post("/demo/scenarios/:name", controller.runScenario);
    router.post("/demo/workers/:id/crash", controller.crashWorker);
  }
  return router;
};
