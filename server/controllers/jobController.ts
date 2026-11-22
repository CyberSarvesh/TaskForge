import type { Request, Response } from "express";
import type { Redis } from "ioredis";
import { z } from "zod";
import { HttpError } from "../lib/errors.ts";
import * as jobs from "../services/jobService.ts";
import * as store from "../services/jobStore.ts";

const idSchema = z.uuid();
const listSchema = z.object({
  status: z.enum(["pending", "scheduled", "processing", "completed", "failed", "cancelled"]).optional(),
  type: z.string().max(60).optional(),
  search: z.string().regex(/^[0-9a-fA-F-]{1,36}$/, "Search takes the start of a job id").optional(),
  before: z.string().regex(/^\d{1,18}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const jobId = (req: Request) => jobs.parse(idSchema, req.params.id, "job id");

const requireJob = async (id: string) => {
  const job = await store.findJob(id);
  if (!job) throw new HttpError(404, "not_found", "Job not found");
  return job;
};

export const createJobController = (redis: Redis) => {
  const submit = (req: Request) => jobs.submit(redis, jobs.buildJob(req.body, req.get("idempotency-key")));

  return {
    /** POST /jobs and GET /jobs/:id keep the response shape of the first version. */
    async createJob(req: Request, res: Response) {
      const { job } = await submit(req);
      res.json({ message: "Job created", jobId: job.id });
    },

    async getJob(req: Request, res: Response) {
      res.json(await requireJob(jobId(req)));
    },

    async create(req: Request, res: Response) {
      const { job, replayed } = await submit(req);
      res.status(replayed ? 200 : 202).location(`/api/jobs/${job.id}`).json({ job, replayed });
    },

    async list(req: Request, res: Response) {
      res.json(await store.listJobs(jobs.parse(listSchema, req.query, "filter")));
    },

    async detail(req: Request, res: Response) {
      const id = jobId(req);
      res.json({ job: await requireJob(id), events: await store.findEvents(id) });
    },

    async cancel(req: Request, res: Response) {
      res.json({ job: await jobs.cancel(jobId(req)) });
    },

    async retry(req: Request, res: Response) {
      res.json({ job: await jobs.retry(redis, jobId(req)) });
    },
  };
};
