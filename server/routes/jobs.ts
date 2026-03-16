import express from "express";
import { createJob, getJob } from "../controllers/jobController.ts";

const router = express.Router();

router.post("/", createJob);
router.get("/:id", getJob);

export default router;