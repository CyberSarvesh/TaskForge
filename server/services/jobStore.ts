import { randomUUID } from "node:crypto";
import { query } from "../db/postgres.ts";
import type { Priority } from "../lib/policy.ts";
import type { Dispatchable } from "./queueService.ts";

/*
 * Every state transition in the system lives in this file. Two rules hold throughout:
 *
 *  1. A transition and its event are written by one statement, so they commit or fail together.
 *  2. Anything a worker writes is guarded by its lease token. A worker that stalled, lost its
 *     lease and woke up later matches zero rows and cannot overwrite the new owner's result.
 */

export type JobStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

export interface Job extends Dispatchable {
  seq: string;
  type: string;
  payload: unknown;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  worker: string | null;
  result: unknown;
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export interface NewJob {
  type: string;
  payload: unknown;
  priority: Priority;
  maxAttempts: number;
  delayMs: number;
  idempotencyKey?: string | undefined;
}

const COLUMNS = `id, seq, type, payload, status, priority, attempts, max_attempts, run_at,
  worker, result, error, created_at, started_at, completed_at`;

export const insertJobs = async (jobs: NewJob[]) => {
  const rows = jobs.map((job) => ({
    id: randomUUID(),
    type: job.type,
    payload: job.payload,
    priority: job.priority,
    max_attempts: job.maxAttempts,
    delay_ms: job.delayMs,
    idempotency_key: job.idempotencyKey ?? null,
  }));
  const { rows: created } = await query<Job>(
    `WITH input AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS i(
         id uuid, type text, payload jsonb, priority text,
         max_attempts int, delay_ms int, idempotency_key text)
     ), created AS (
       INSERT INTO jobs (id, type, payload, status, priority, max_attempts, run_at, idempotency_key)
       SELECT id, type, payload, 'pending', priority, max_attempts,
              now() + delay_ms * interval '1 millisecond', idempotency_key
       FROM input
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING ${COLUMNS}
     ), event AS (
       INSERT INTO job_events (job_id, kind)
       SELECT id, CASE WHEN run_at > now() THEN 'scheduled' ELSE 'created' END FROM created
     )
     SELECT * FROM created`,
    [JSON.stringify(rows)],
  );
  return created;
};

export const findByKey = async (key: string, type: string, payload: unknown) => {
  const { rows } = await query<Job & { same_request: boolean }>(
    `SELECT ${COLUMNS}, (type = $2 AND payload = $3::jsonb) AS same_request
     FROM jobs WHERE idempotency_key = $1`,
    [key, type, JSON.stringify(payload)],
  );
  return rows[0];
};

export const findJob = async (id: string) =>
  (await query<Job>(`SELECT ${COLUMNS} FROM jobs WHERE id = $1`, [id])).rows[0];

export const findEvents = async (id: string) =>
  (await query(
    `SELECT id, kind, attempt, worker, detail, wait_ms, run_ms, at
     FROM job_events WHERE job_id = $1 ORDER BY id DESC LIMIT 200`,
    [id],
  )).rows.reverse();

export interface ListFilter {
  status?: JobStatus | "scheduled" | undefined;
  type?: string | undefined;
  search?: string | undefined;
  before?: string | undefined;
  limit: number;
}

export const listJobs = async ({ status, type, search, before, limit }: ListFilter) => {
  const where: string[] = [];
  const params: unknown[] = [];
  const bind = (value: unknown) => `$${params.push(value)}`;

  if (status === "scheduled") where.push("status = 'pending' AND run_at > now()");
  else if (status === "pending") where.push("status = 'pending' AND run_at <= now()");
  else if (status) where.push(`status = ${bind(status)}`);
  if (type) where.push(`type = ${bind(type)}`);
  if (search) where.push(`id::text LIKE ${bind(`${search.toLowerCase()}%`)}`);
  if (before) where.push(`seq < ${bind(before)}`);

  const { rows } = await query<Job>(
    `SELECT ${COLUMNS} FROM jobs ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY seq DESC LIMIT ${bind(limit + 1)}`,
    params,
  );
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items.at(-1)!.seq : null };
};

export const markDispatched = (ids: string[]) =>
  query("UPDATE jobs SET dispatched_at = now() WHERE id = ANY($1::uuid[]) AND status = 'pending'", [ids]);

/**
 * Due jobs that were never dispatched, or were dispatched long enough ago that the entry may be lost.
 * Never-dispatched first, so a deep backlog cannot hide new work from the sweeper.
 */
export const takeDispatchable = async (staleMs: number) =>
  (await query<Dispatchable>(
    `UPDATE jobs SET dispatched_at = now()
     WHERE id IN (
       SELECT id FROM jobs
       WHERE status = 'pending' AND run_at <= now()
         AND (dispatched_at IS NULL OR dispatched_at < now() - $1::int * interval '1 millisecond')
       ORDER BY dispatched_at NULLS FIRST, run_at
       LIMIT 1000 FOR UPDATE SKIP LOCKED)
     RETURNING id, priority, run_at`,
    [staleMs],
  )).rows;

/** Queue messages may be duplicated or stale; this conditional update decides who runs a job. */
export const claimJob = async (id: string, worker: string, token: string, leaseMs: number) =>
  (await query<Job>(
    `WITH claimed AS (
       UPDATE jobs SET status = 'processing', attempts = attempts + 1, worker = $2, lease_token = $3,
         lease_until = now() + $4::int * interval '1 millisecond', started_at = now()
       WHERE id = $1 AND status = 'pending' AND run_at <= now()
       RETURNING ${COLUMNS}
     ), event AS (
       INSERT INTO job_events (job_id, kind, attempt, worker, wait_ms)
       SELECT id, 'started', attempts, worker,
         LEAST(2147483647, GREATEST(0, extract(epoch FROM now() - run_at) * 1000))::int
       FROM claimed
     )
     SELECT * FROM claimed`,
    [id, worker, token, leaseMs],
  )).rows[0];

/** Returns the tokens that are still valid. A missing one was cancelled or taken over. */
export const renewLeases = async (tokens: string[], leaseMs: number) =>
  new Set(
    (await query<{ lease_token: string }>(
      `UPDATE jobs SET lease_until = now() + $2::int * interval '1 millisecond'
       WHERE lease_token = ANY($1::uuid[]) AND status = 'processing'
       RETURNING lease_token`,
      [tokens, leaseMs],
    )).rows.map((row) => row.lease_token),
  );

export const completeJob = async (id: string, token: string, result: unknown) =>
  (await query(
    `WITH done AS (
       UPDATE jobs SET status = 'completed', result = $3::jsonb, error = NULL, completed_at = now(),
         lease_token = NULL, lease_until = NULL
       WHERE id = $1 AND lease_token = $2 AND status = 'processing'
       RETURNING id, attempts, worker, started_at
     )
     INSERT INTO job_events (job_id, kind, attempt, worker, run_ms)
     SELECT id, 'completed', attempts, worker, (extract(epoch FROM now() - started_at) * 1000)::int
     FROM done`,
    [id, token, JSON.stringify(result ?? null)],
  )).rowCount === 1;

/** retryInMs = null means "do not retry". */
export const failJob = async (id: string, token: string, message: string, retryInMs: number | null) =>
  (await query(
    `WITH done AS (
       UPDATE jobs SET
         status = CASE WHEN $4::int IS NULL THEN 'failed' ELSE 'pending' END,
         run_at = CASE WHEN $4::int IS NULL THEN run_at ELSE now() + $4::int * interval '1 millisecond' END,
         completed_at = CASE WHEN $4::int IS NULL THEN now() END,
         error = $3, dispatched_at = NULL, lease_token = NULL, lease_until = NULL
       WHERE id = $1 AND lease_token = $2 AND status = 'processing'
       RETURNING id, attempts, worker, started_at
     )
     INSERT INTO job_events (job_id, kind, attempt, worker, detail, run_ms)
     SELECT id, CASE WHEN $4::int IS NULL THEN 'failed' ELSE 'retrying' END, attempts, worker, $3,
       (extract(epoch FROM now() - started_at) * 1000)::int
     FROM done`,
    [id, token, message, retryInMs],
  )).rowCount === 1;

/** Graceful shutdown hands work back without using up an attempt. */
export const releaseJob = (id: string, token: string) =>
  query(
    `WITH released AS (
       UPDATE jobs SET status = 'pending', attempts = GREATEST(0, attempts - 1), run_at = now(),
         dispatched_at = NULL, lease_token = NULL, lease_until = NULL
       WHERE id = $1 AND lease_token = $2 AND status = 'processing'
       RETURNING id, attempts, worker
     )
     INSERT INTO job_events (job_id, kind, attempt, worker, detail)
     SELECT id, 'released', attempts, worker, 'worker shut down' FROM released`,
    [id, token],
  );

export const recoverExpiredLeases = async () =>
  (await query(
    `WITH expired AS (
       SELECT id FROM jobs
       WHERE status = 'processing' AND (lease_until IS NULL OR lease_until < now())
       LIMIT 500 FOR UPDATE SKIP LOCKED
     ), recovered AS (
       UPDATE jobs j SET
         status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
         completed_at = CASE WHEN attempts >= max_attempts THEN now() END,
         error = 'Lease expired: the worker stopped responding',
         run_at = now(), dispatched_at = NULL, lease_token = NULL, lease_until = NULL
       FROM expired WHERE j.id = expired.id
       RETURNING j.id, j.status, j.attempts, j.worker, j.error
     )
     INSERT INTO job_events (job_id, kind, attempt, worker, detail)
     SELECT id, CASE WHEN status = 'failed' THEN 'failed' ELSE 'recovered' END, attempts, worker, error
     FROM recovered`,
  )).rowCount ?? 0;

export const cancelJob = async (id: string) =>
  (await query<Job>(
    `WITH changed AS (
       UPDATE jobs SET status = 'cancelled', completed_at = now(), lease_token = NULL, lease_until = NULL
       WHERE id = $1 AND status IN ('pending', 'processing')
       RETURNING ${COLUMNS}
     ), event AS (
       INSERT INTO job_events (job_id, kind, attempt, worker)
       SELECT id, 'cancelled', attempts, worker FROM changed
     )
     SELECT * FROM changed`,
    [id],
  )).rows[0];

export const requeueJob = async (id: string) =>
  (await query<Job>(
    `WITH changed AS (
       UPDATE jobs SET status = 'pending', attempts = 0, run_at = now(), dispatched_at = NULL,
         completed_at = NULL, started_at = NULL, error = NULL, worker = NULL
       WHERE id = $1 AND status IN ('failed', 'cancelled')
       RETURNING ${COLUMNS}
     ), event AS (
       INSERT INTO job_events (job_id, kind) SELECT id, 'requeued' FROM changed
     )
     SELECT * FROM changed`,
    [id],
  )).rows[0];
