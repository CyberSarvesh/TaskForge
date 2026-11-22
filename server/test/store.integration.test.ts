import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { createDatabase, environment } from "./helpers.ts";

const database = await createDatabase();
Object.assign(process.env, environment(database.name));

// These read the configuration when imported, so they must load after the environment is set.
const { migrate } = await import("../db/migrate.ts");
const { default: pool, query } = await import("../db/postgres.ts");
const store = await import("../services/jobStore.ts");

await Promise.all([migrate(), migrate(), migrate()]); // concurrent boots must not collide

after(async () => {
  await pool.end();
  await database.drop();
});

const newJob = async () =>
  (await store.insertJobs([{ type: "report", payload: {}, priority: "normal", maxAttempts: 3, delayMs: 0 }]))[0]!;

test("only one of many simultaneous claims wins", async () => {
  const { id } = await newJob();
  const claims = await Promise.all(Array.from({ length: 25 }, (_, i) => store.claimJob(id, `w${i}`, randomUUID(), 5000)));
  assert.equal(claims.filter(Boolean).length, 1);
});

test("a stale worker cannot write over the new owner", async () => {
  const { id } = await newJob();
  const stale = randomUUID();
  await store.claimJob(id, "stale", stale, 5000);
  await query("UPDATE jobs SET lease_until = now() - interval '1 second' WHERE id = $1", [id]);
  await store.recoverExpiredLeases();
  const current = randomUUID();
  await store.claimJob(id, "current", current, 5000);

  assert.equal(await store.completeJob(id, stale, { from: "stale" }), false);
  assert.equal(await store.failJob(id, stale, "stale failure", null), false);
  assert.equal((await store.renewLeases([stale], 5000)).size, 0);
  assert.equal(await store.completeJob(id, current, { from: "current" }), true);
  assert.deepEqual((await store.findJob(id))!.result, { from: "current" });
});
