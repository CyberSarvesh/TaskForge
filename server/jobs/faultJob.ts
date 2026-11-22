import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { PermanentError } from "../lib/errors.ts";
import { defineJob } from "./types.ts";

export const faultJob = defineJob({
  title: "Inject a fault",
  description: "Fails on purpose, to exercise retries, backoff and the dead-letter state.",
  timeoutMs: 30_000,
  schema: z.looseObject({
    durationMs: z.number().int().min(0).max(60_000).default(1500),
    failTimes: z.number().int().min(0).max(20).default(1),
    permanent: z.boolean().default(false),
  }),
  fields: [
    { name: "durationMs", label: "Work time (ms)", kind: "number", default: 1500, min: 0, max: 60_000 },
    { name: "failTimes", label: "Attempts that fail", kind: "number", default: 1, min: 0, max: 20 },
    { name: "permanent", label: "Unrecoverable (skip retries)", kind: "boolean", default: false },
  ],
  async run({ durationMs, failTimes, permanent }, { attempt, signal }) {
    await sleep(durationMs, undefined, { signal });
    if (permanent) throw new PermanentError("Injected unrecoverable failure");
    if (attempt <= failTimes) throw new Error(`Injected failure ${attempt} of ${failTimes}`);
    return { succeededOnAttempt: attempt };
  },
});
