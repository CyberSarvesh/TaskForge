import type { Redis } from "ioredis";
import { config } from "../config.ts";
import { queueScore } from "../lib/policy.ts";
import type { Priority } from "../lib/policy.ts";

/**
 * The ready queue is a sorted set and is only an index: Postgres owns the truth.
 * A set makes dispatch idempotent, so the sweeper can safely re-add anything it is unsure about,
 * and the whole key can be deleted without losing a job.
 */
export const QUEUE_KEY = `${config.QUEUE_PREFIX}:ready`;

export interface Dispatchable {
  id: string;
  priority: Priority;
  run_at: Date;
}

export const enqueue = async (redis: Redis, jobs: Dispatchable[]) => {
  if (!jobs.length) return;
  const members = jobs.flatMap((job) => [queueScore(job.priority, job.run_at), job.id]);
  await redis.zadd(QUEUE_KEY, "NX", ...members);
};

export const takeNext = async (redis: Redis, timeoutSeconds = 1) => {
  const next = await redis.bzpopmin(QUEUE_KEY, timeoutSeconds);
  return next ? next[1] : null;
};

export const queueDepth = (redis: Redis) => redis.zcard(QUEUE_KEY);
