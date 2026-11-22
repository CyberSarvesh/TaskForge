import express from "express";
import jobRoutes from "../routes/jobs.ts";
import cors from "cors";
import { config } from "../config.ts";
import { migrateWithRetry } from "../db/migrate.ts";


await migrateWithRetry();

const app = express();

app.use(cors());
app.use(express.json());

app.use("/jobs", jobRoutes);

app.get("/", (_req, res) => {
  res.send("TaskForge API running");
});

const PORT = config.PORT;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});