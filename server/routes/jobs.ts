import express from "express";
import type { createJobController } from "../controllers/jobController.ts";

type Controller = ReturnType<typeof createJobController>;

export const legacyJobRoutes = (controller: Controller) => {
  const router = express.Router();
  router.post("/", controller.createJob);
  router.get("/:id", controller.getJob);
  return router;
};

export const jobRoutes = (controller: Controller) => {
  const router = express.Router();
  router.get("/", controller.list);
  router.post("/", controller.create);
  router.get("/:id", controller.detail);
  router.post("/:id/cancel", controller.cancel);
  router.post("/:id/retry", controller.retry);
  return router;
};
