import express from "express";
import jobRoutes from "../routes/jobs.ts";
import cors from "cors";


const app = express();

app.use(cors());
app.use(express.json());

app.use("/jobs", jobRoutes);

app.get("/", (req, res) => {
  res.send("TaskForge API running");
});

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});