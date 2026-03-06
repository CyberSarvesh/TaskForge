import express from "express";
import jobRoutes from "../routes/jobs.ts";

const app = express();

app.use(express.json());

app.use("/jobs", jobRoutes);

app.get("/", (req, res) => {
  res.send("TaskForge API running");
});

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});