import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { defineJob } from "./types.ts";

export const emailJob = defineJob({
  title: "Send email",
  description: "Simulated delivery that takes 1.5 to 3 seconds. Nothing is actually sent.",
  timeoutMs: 10_000,
  schema: z.looseObject({
    to: z.email().max(254),
    subject: z.string().max(200).optional(),
  }),
  fields: [
    { name: "to", label: "Recipient", kind: "email", default: "ada@example.com" },
    { name: "subject", label: "Subject", kind: "text", default: "Your export is ready" },
  ],
  async run(payload, { id, signal }) {
    await sleep(1500 + Math.random() * 1500, undefined, { signal });
    // A real provider would get the job id as its idempotency key, because delivery is at-least-once.
    return { simulated: true, to: payload.to, messageId: `sim-${id}` };
  },
});
