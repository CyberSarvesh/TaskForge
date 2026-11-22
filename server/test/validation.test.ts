import assert from "node:assert/strict";
import { after, test } from "node:test";
import pool from "../db/postgres.ts";
import { HttpError } from "../lib/errors.ts";
import { describeJobTypes, getDefinition } from "../jobs/registry.ts";
import { buildJob } from "../services/jobService.ts";
import { scenarioJobs, scenarioNames } from "../services/scenarios.ts";

after(() => pool.end());

const rejects = (body: unknown) =>
  assert.throws(() => buildJob(body), (error) => error instanceof HttpError && error.status === 400);

test("bad requests are rejected", () => {
  rejects(undefined);
  rejects([]);
  rejects({ type: "nonsense" });
  rejects({ type: "constructor" });
  rejects({ type: "email", payload: {} });
  rejects({ type: "email", payload: { to: "not-an-email" } });
  rejects({ type: "report", priority: "urgent" });
  rejects({ type: "report", maxAttempts: 0 });
  rejects({ type: "report", delayMs: -1 });
  rejects({ type: "hash", payload: { rounds: 1e9 } });
});

test("defaults are applied", () => {
  assert.deepEqual(buildJob({ type: "report" }), {
    type: "report", payload: { type: "daily" }, priority: "normal",
    maxAttempts: 3, delayMs: 0, idempotencyKey: undefined,
  });
});

test("extra payload fields from existing callers are kept", () => {
  const job = buildJob({ type: "email", payload: { to: "a@example.com", template: "welcome" } });
  assert.deepEqual(job.payload, { to: "a@example.com", template: "welcome" });
});

test("every form's defaults pass that job's own validation", () => {
  for (const { type, fields } of describeJobTypes()) {
    const payload = Object.fromEntries(fields.map((field) => [field.name, field.default]));
    assert.ok(getDefinition(type)!.schema.safeParse(payload).success, type);
  }
});

test("every demo scenario builds valid jobs", () => {
  for (const name of scenarioNames) assert.ok(scenarioJobs(name).length > 0, name);
});
