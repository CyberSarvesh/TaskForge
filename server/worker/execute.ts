import { PermanentError } from "../lib/errors.ts";
import { getDefinition } from "../jobs/registry.ts";
import type { Job } from "../services/jobStore.ts";

export const execute = async (job: Job, signal: AbortSignal) => {
  const definition = getDefinition(job.type);
  if (!definition) throw new PermanentError(`No handler for job type "${job.type}"`);

  // Validate again: the row may predate the current schema or come from another producer.
  const payload = definition.schema.safeParse(job.payload ?? {});
  if (!payload.success) throw new PermanentError("Payload failed validation");

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timed out after ${definition.timeoutMs} ms`)),
    definition.timeoutMs,
  );
  const combined = AbortSignal.any([signal, controller.signal]);

  // Raced, so a handler that ignores the signal still cannot hold a slot forever.
  const aborted = new Promise<never>((_resolve, reject) => {
    combined.addEventListener("abort", () => reject(combined.reason), { once: true });
  });

  try {
    return await Promise.race([
      definition.run(payload.data, { id: job.id, attempt: job.attempts, signal: combined }),
      aborted,
    ]);
  } catch (error) {
    throw combined.aborted ? combined.reason : error;
  } finally {
    clearTimeout(timer);
  }
};
