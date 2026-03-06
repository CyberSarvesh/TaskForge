import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const jobs: any = {};

export const createJob = (req: Request, res: Response) => {
  const id = uuidv4();

  const job = {
    id,
    type: req.body.type,
    payload: req.body.payload,
    status: "pending",
  };

  jobs[id] = job;

  res.json({
    message: "Job created",
    jobId: id,
  });
};

export const getJob = (req: Request, res: Response) => {
  const job = jobs[req.params.id];

  if (!job) {
    return res.status(404).json({
      error: "Job not found",
    });
  }

  res.json(job);
};