import { config } from "../config.ts";
import { query } from "../db/postgres.ts";
import { HttpError } from "../lib/errors.ts";
import type { Field, JobDefinition } from "../jobs/types.ts";
import type { NewJob } from "./jobStore.ts";

/*
 * Rules for an instance that anonymous visitors share. They apply only when PUBLIC_DEMO is on.
 * The important one: visitors cannot store text. Everyone sees every job, so free text would
 * leak whatever one visitor typed (an email address, say) and let anyone post on the page.
 */

export const LIMITS = {
  activeJobs: 150,
  finishedJobs: 1000,
  events: 20_000,
  maxAttempts: 5,
  delayMs: 60_000,
  fieldMax: { rounds: 40, durationMs: 10_000 } as Record<string, number>,
};

const isText = (field: Field) => field.kind === "text" || field.kind === "email";

/** What the form should offer. */
export const publicFields = (fields: Field[]) =>
  fields.map((field) => {
    const max = LIMITS.fieldMax[field.name];
    return { ...field, ...(max !== undefined && { max }), ...(isText(field) && { locked: true }) };
  });

/** Rebuilds the payload from the declared fields, so unknown keys and typed text never get stored. */
export const restrictJob = (job: NewJob, definition: JobDefinition): NewJob => {
  if (!config.PUBLIC_DEMO) return job;

  const tooBig = (what: string, max: number) =>
    new HttpError(400, "demo_limit", `The public demo allows ${what} up to ${max}`);
  if (job.maxAttempts > LIMITS.maxAttempts) throw tooBig("maxAttempts", LIMITS.maxAttempts);
  if (job.delayMs > LIMITS.delayMs) throw tooBig("delayMs", LIMITS.delayMs);

  const given = job.payload as Record<string, unknown>;
  const payload: Record<string, unknown> = {};
  for (const field of definition.fields) {
    const value = isText(field) ? field.default : (given[field.name] ?? field.default);
    const max = LIMITS.fieldMax[field.name];
    if (max !== undefined && Number(value) > max) throw tooBig(field.name, max);
    payload[field.name] = value;
  }
  return { ...job, payload };
};

let admission: Promise<unknown> = Promise.resolve();

/** Counting and inserting take turns, otherwise a burst of requests would all see room. */
export const withRoom = <T>(adding: number, insert: () => Promise<T>): Promise<T> => {
  if (!config.PUBLIC_DEMO) return insert();
  const result = admission.then(async () => {
    const { rows } = await query<{ active: number }>(
      "SELECT count(*)::int AS active FROM jobs WHERE status IN ('pending', 'processing')",
    );
    if (rows[0]!.active + adding > LIMITS.activeJobs) {
      throw new HttpError(429, "demo_full", "The demo forge is full. Try again when some jobs have finished.");
    }
    return insert();
  });
  admission = result.catch(() => {});
  return result;
};

export const prune = async () => {
  await query(
    `DELETE FROM jobs
     WHERE status IN ('completed', 'failed', 'cancelled')
       AND id IN (
         SELECT id FROM jobs WHERE status IN ('completed', 'failed', 'cancelled')
         ORDER BY seq DESC OFFSET $1)`,
    [LIMITS.finishedJobs],
  );
  // One job requeued over and over would otherwise grow a history without end.
  await query("DELETE FROM job_events WHERE id <= (SELECT max(id) FROM job_events) - $1::int", [LIMITS.events]);
  await query("DELETE FROM workers WHERE last_seen < now() - interval '5 minutes'");
};
