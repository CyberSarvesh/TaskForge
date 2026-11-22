import type { Redis } from "ioredis";
import { z } from "zod";
import { HttpError } from "../lib/errors.ts";
import { describeError, log } from "../lib/logger.ts";
import { PRIORITIES } from "../lib/policy.ts";
import { getDefinition } from "../jobs/registry.ts";
import * as store from "./jobStore.ts";
import { enqueue } from "./queueService.ts";

const requestSchema = z.object({
  type: z.string().min(1).max(60),
  payload: z.unknown().optional(),
  priority: z.enum(PRIORITIES).default("normal"),
  maxAttempts: z.number().int().min(1).max(20).default(3),
  delayMs: z.number().int().min(0).max(7 * 86_400_000).default(0),
});

const keySchema = z.string().min(1).max(200).optional();

export const parse = <S extends z.ZodType>(schema: S, value: unknown, what = "request"): z.output<S> => {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
  throw new HttpError(400, "invalid_input", `Invalid ${what}`, issues);
};

export const buildJob = (body: unknown, idempotencyKey?: string): store.NewJob => {
  const request = parse(requestSchema, body);
  const definition = getDefinition(request.type);
  if (!definition) throw new HttpError(400, "unknown_type", `Unknown job type "${request.type}"`);
  return {
    ...request,
    payload: parse(definition.schema, request.payload ?? {}, "payload"),
    idempotencyKey: parse(keySchema, idempotencyKey, "Idempotency-Key"),
  };
};

/**
 * Best effort by design. The job is already committed, so if this fails the caller still gets a
 * success and a sweeper dispatches it once Redis is back.
 */
const dispatch = async (redis: Redis, jobs: store.Job[]) => {
  const due = jobs.filter(
    // Compare to created_at too, in case the database clock is slightly ahead of ours.
    (job) => job.run_at.getTime() <= job.created_at.getTime() || job.run_at.getTime() <= Date.now(),
  );
  if (!due.length) return;
  try {
    await enqueue(redis, due);
    await store.markDispatched(due.map((job) => job.id));
  } catch (error) {
    log.warn("dispatch deferred to sweeper", { count: due.length, error: describeError(error) });
  }
};

export const submitMany = async (redis: Redis, jobs: store.NewJob[]) => {
  const created = await store.insertJobs(jobs);
  await dispatch(redis, created);
  return created;
};

export const submit = async (redis: Redis, input: store.NewJob) => {
  const [job] = await submitMany(redis, [input]);
  if (job) return { job, replayed: false };

  const existing = await store.findByKey(input.idempotencyKey!, input.type, input.payload);
  if (!existing) throw new HttpError(409, "conflict", "The original request changed, try again");
  const { same_request, ...original } = existing;
  if (!same_request) {
    throw new HttpError(422, "key_reused", "This Idempotency-Key was used with a different job");
  }
  return { job: original, replayed: true };
};

const explainMiss = async (id: string, action: string) => {
  const job = await store.findJob(id);
  return job
    ? new HttpError(409, "invalid_state", `Cannot ${action} a job that is ${job.status}`)
    : new HttpError(404, "not_found", "Job not found");
};

export const cancel = async (id: string) => {
  const job = await store.cancelJob(id);
  if (!job) throw await explainMiss(id, "cancel");
  return job;
};

export const retry = async (redis: Redis, id: string) => {
  const job = await store.requeueJob(id);
  if (!job) throw await explainMiss(id, "retry");
  await dispatch(redis, [job]);
  return job;
};
