import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { query } from "../db/postgres.ts";
import { defineJob } from "./types.ts";

export const reportJob = defineJob({
  title: "Build report",
  description: "Aggregates the last 24 hours of this queue's own jobs from Postgres.",
  timeoutMs: 15_000,
  schema: z.looseObject({ type: z.string().max(60).default("daily") }),
  fields: [{ name: "type", label: "Report name", kind: "text", default: "daily" }],
  async run(payload, { signal }) {
    const { rows } = await query(
      `SELECT type, status, count(*)::int AS count
       FROM jobs WHERE created_at > now() - interval '24 hours'
       GROUP BY 1, 2 ORDER BY 1, 2`,
    );
    // The query takes milliseconds; the pause stands in for rendering a document.
    await sleep(2500 + Math.random() * 1500, undefined, { signal });
    return { report: payload.type, generatedAt: new Date().toISOString(), rows };
  },
});
