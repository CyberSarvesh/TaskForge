import express from "express";
import cors from "cors";
import { config } from "../config.ts";
import { createJobController } from "../controllers/jobController.ts";
import { migrateWithRetry } from "../db/migrate.ts";
import { createRedis } from "../redis/redisClient.ts";
import { legacyJobRoutes } from "../routes/jobs.ts";
import { errorHandler } from "./errorHandler.ts";

await migrateWithRetry();

const app = express();

app.use(cors());
app.use(express.json());

app.use("/jobs", legacyJobRoutes(createJobController(createRedis("api"))));

app.get("/", (_req, res) => {
  res.send("TaskForge API running");
});

app.use(errorHandler);

app.listen(config.PORT, () => {
  console.log(`Server running on port ${config.PORT}`);
});
