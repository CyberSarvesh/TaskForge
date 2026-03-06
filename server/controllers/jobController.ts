import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { query } from "../db/postgres.ts";
import { addJobToQueue } from "../services/queueService.ts";

export const createJob = async (req: Request, res: Response) => {
  const id = uuidv4();
  const { type, payload } = req.body;

  await query(
    "INSERT INTO jobs (id, type, payload, status) VALUES ($1,$2,$3,$4)",
    [id, type, payload, "pending"]
  );

  await addJobToQueue(id);

  res.json({
    message: "Job created",
    jobId: id,
  });
};

export const getJob = async (req: Request, res: Response) => {
  const result = await query(
    "SELECT * FROM jobs WHERE id = $1",
    [req.params.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.json(result.rows[0]);
};