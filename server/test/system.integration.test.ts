import assert from "node:assert/strict";
import { once } from "node:events";
import { request } from "node:http";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { startSystem, until } from "./helpers.ts";

const work = (durationMs: number, failTimes = 0) => ({ type: "fault", payload: { durationMs, failTimes } });

test("the original /jobs contract still works", async (t) => {
  const app = await startSystem(t, { workers: 1 });
  const created = await app.call("/jobs", { type: "email", payload: { to: "ada@example.com" } });
  assert.equal(created.status, 200);
  assert.deepEqual(Object.keys(created.body), ["message", "jobId"]);
  await app.waitFor(created.body.jobId, "completed");

  const { body } = await app.call(`/jobs/${created.body.jobId}`);
  assert.equal(body.status, "completed");
  assert.equal(body.payload.to, "ada@example.com");
  assert.ok(body.completed_at);
});

test("bad input is a 4xx and never leaks a stack trace", async (t) => {
  const app = await startSystem(t);
  const cases = [
    [await fetch(`${app.base}/jobs`, { method: "POST" }).then(async (r) => ({ status: r.status, text: await r.text() })), 400],
    [await app.call("/jobs/not-a-uuid"), 400],
    [await app.call("/jobs/00000000-0000-4000-8000-000000000000"), 404],
    [await app.call("/jobs", "{not json"), 400],
    [await app.call("/jobs", { type: "nonsense" }), 400],
    [await app.call("/jobs", { type: "report", payload: { type: "a\u0000b" } }), 400],
    [await app.call("/jobs", { type: "report", payload: { junk: "x".repeat(70_000) } }), 413],
    [await app.call("/api/jobs?limit=100000"), 400],
    [await app.call("/api/jobs?search=%25"), 400],
  ] as const;
  for (const [response, status] of cases) {
    assert.equal(response.status, status, response.text);
    assert.doesNotMatch(response.text, /node_modules|\.ts:\d+/);
  }
});

test("a killed worker's job is recovered by another", async (t) => {
  const app = await startSystem(t);
  const victim = await app.addWorker();
  const id = await app.create(work(1500));
  await app.waitFor(id, "processing");
  victim.child.kill("SIGKILL");
  await once(victim.child, "exit");

  const rescuer = await app.addWorker();
  const { job, events } = await app.waitFor(id, "completed");
  assert.equal(job.worker, rescuer.name);
  assert.equal(job.attempts, 2);
  assert.ok(events.some((event: { kind: string }) => event.kind === "recovered"));
});

test("a job that kills every worker stops after max attempts", async (t) => {
  const app = await startSystem(t);
  const victim = await app.addWorker();
  const id = await app.create({ ...work(5000), maxAttempts: 1 });
  await app.waitFor(id, "processing");
  victim.child.kill("SIGKILL");
  await app.addWorker();
  assert.match((await app.waitFor(id, "failed")).job.error, /Lease expired/);
});

test("a healthy job may run far longer than its lease", async (t) => {
  const app = await startSystem(t, { workers: 2 });
  const id = await app.create(work(5000));
  assert.equal((await app.waitFor(id, "completed")).job.attempts, 1);
});

test("jobs are accepted while Redis is down and run when it returns", async (t) => {
  const app = await startSystem(t, { workers: 1 });
  app.link.cut();
  await until(async () => (await app.call("/api/health")).body.status === "degraded", "degraded health");

  const started = Date.now();
  const id = await app.create(work(100));
  assert.ok(Date.now() - started < 2500, "create must not hang on Redis");
  await sleep(1000);
  assert.equal((await app.call(`/api/jobs/${id}`)).body.job.status, "pending");

  app.link.restore();
  await app.waitFor(id, "completed");
});

test("losing every queue entry loses no jobs", async (t) => {
  const app = await startSystem(t);
  const ids = await Promise.all(Array.from({ length: 10 }, () => app.create(work(20))));
  assert.equal(await app.redis.del(`${app.database.name}:ready`), 1);
  await app.addWorker();
  for (const id of ids) await app.waitFor(id, "completed");
});

test("API and worker survive Postgres dropping every connection", async (t) => {
  const app = await startSystem(t, { workers: 1 });
  await app.db.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()",
  );
  await sleep(1500);
  assert.equal(app.api.exitCode, null);
  assert.equal(app.workers[0]!.child.exitCode, null);
  await app.waitFor(await app.create(work(50)), "completed");
});

test("retries back off and then succeed", async (t) => {
  const app = await startSystem(t, { workers: 1 });
  const id = await app.create(work(20, 2));
  const { job, events } = await app.waitFor(id, "completed");
  assert.equal(job.attempts, 3);
  const at = (kind: string) =>
    events.filter((e: { kind: string }) => e.kind === kind).map((e: { at: string }) => Date.parse(e.at));
  assert.ok(at("started")[1] - at("retrying")[0] >= 450, "first retry waits at least half a second");
});

test("exhausted and permanent failures rest as failed until requeued", async (t) => {
  const app = await startSystem(t, { workers: 1 });
  const exhausted = await app.create({ ...work(20, 9), maxAttempts: 2 });
  const permanent = await app.create({ type: "fault", payload: { durationMs: 20, permanent: true } });
  assert.equal((await app.waitFor(exhausted, "failed")).job.attempts, 2);
  assert.equal((await app.waitFor(permanent, "failed")).job.attempts, 1);

  assert.equal((await app.call(`/api/jobs/${exhausted}/retry`, {})).status, 200);
  const again = await app.waitFor(exhausted, "failed");
  assert.ok(again.events.some((event: { kind: string }) => event.kind === "requeued"));
});

test("unknown types already in the database fail instead of completing", async (t) => {
  const app = await startSystem(t, { workers: 1 });
  const { rows } = await app.db.query(
    "INSERT INTO jobs (id, type, payload, status) VALUES (gen_random_uuid(), 'nonsense', '{}', 'pending') RETURNING id",
  );
  assert.match((await app.waitFor(rows[0].id, "failed")).job.error, /No handler/);
});

test("cancelling a running job frees its slot", async (t) => {
  const app = await startSystem(t);
  await app.addWorker({ WORKER_CONCURRENCY: "1" });
  const long = await app.create(work(20_000));
  await app.waitFor(long, "processing");
  const next = await app.create(work(20));

  assert.equal((await app.call(`/api/jobs/${long}/cancel`, {})).status, 200);
  await app.waitFor(next, "completed", 5000);
  assert.equal((await app.call(`/api/jobs/${long}`)).body.job.status, "cancelled");
  assert.equal((await app.call(`/api/jobs/${next}/cancel`, {})).status, 409);
});

test("graceful shutdown hands work back without spending an attempt", async (t) => {
  const app = await startSystem(t, { env: { SHUTDOWN_GRACE_MS: "300" } });
  const { child } = await app.addWorker();
  const id = await app.create(work(8000));
  await app.waitFor(id, "processing");
  child.send("shutdown");
  assert.equal((await once(child, "exit"))[0], 0);

  const { job, events } = await app.waitFor(id, "pending");
  assert.equal(job.attempts, 0);
  assert.equal(events.at(-1).kind, "released");
});

test("higher priority overtakes", async (t) => {
  const app = await startSystem(t);
  const low = await app.create({ ...work(50), priority: "low" });
  const normal = await app.create(work(50));
  const high = await app.create({ ...work(50), priority: "high" });
  await app.addWorker({ WORKER_CONCURRENCY: "1" });
  await app.waitFor(low, "completed");
  const { rows } = await app.db.query("SELECT job_id FROM job_events WHERE kind = 'started' ORDER BY id");
  assert.deepEqual(rows.map((row) => row.job_id), [high, normal, low]);
});

test("delayed jobs do not run early", async (t) => {
  const app = await startSystem(t, { workers: 1 });
  const { job } = await app.waitFor(await app.create({ ...work(10), delayMs: 1500 }), "completed");
  assert.ok(Date.parse(job.started_at) - Date.parse(job.created_at) >= 1500);
});

test("concurrent duplicate requests create one job", async (t) => {
  const app = await startSystem(t);
  const key = { "Idempotency-Key": "order-42" };
  const replies = await Promise.all(Array.from({ length: 20 }, () => app.call("/api/jobs", work(10), key)));
  assert.equal(replies.filter((reply) => reply.status === 202).length, 1);
  assert.equal(new Set(replies.map((reply) => reply.body.job.id)).size, 1);
  assert.equal((await app.call("/api/jobs", work(99), key)).status, 422);
});

test("500 jobs across four workers each run exactly once", async (t) => {
  const app = await startSystem(t, { env: { WORKER_CONCURRENCY: "8", LEASE_MS: "10000" } });
  for (let i = 0; i < 20; i++) await Promise.all(Array.from({ length: 25 }, () => app.create(work(5))));
  await Promise.all([1, 2, 3, 4].map(() => app.addWorker()));
  await until(
    async () => (await app.db.query("SELECT 1 FROM jobs WHERE status <> 'completed' LIMIT 1")).rowCount === 0,
    "500 jobs", 60_000,
  );
  const { rows } = await app.db.query(
    "SELECT count(*)::int AS starts, count(DISTINCT job_id)::int AS jobs FROM job_events WHERE kind = 'started'",
  );
  assert.deepEqual(rows[0], { starts: 500, jobs: 500 });
});

test("pagination covers every job once", async (t) => {
  const app = await startSystem(t);
  const ids = new Set(await Promise.all(Array.from({ length: 23 }, () => app.create(work(10)))));
  const seen: string[] = [];
  let cursor = "";
  do {
    const { body } = await app.call(`/api/jobs?limit=5${cursor && `&before=${cursor}`}`);
    seen.push(...body.items.map((job: { id: string }) => job.id));
    cursor = body.nextCursor ?? "";
  } while (cursor);
  assert.equal(seen.length, 23);
  assert.deepEqual(new Set(seen), ids);
});

test("foreign origins and hosts are refused", async (t) => {
  const app = await startSystem(t);
  assert.equal((await app.call("/api/jobs", work(1), { Origin: "https://evil.example" })).status, 403);
  assert.equal((await app.call("/api/jobs", work(1), { Origin: app.base })).status, 202);

  // fetch will not let us forge Host, so use node:http.
  const status = await new Promise<number | undefined>((resolve, reject) => {
    request({ host: "127.0.0.1", port: app.port, path: "/api/meta", headers: { Host: "evil.example" } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on("error", reject).end();
  });
  assert.equal(status, 403);
});

test("demo endpoints do not exist unless demo mode is on", async (t) => {
  const app = await startSystem(t, { env: { DEMO_MODE: "false" } });
  assert.equal((await app.call("/api/demo/scenarios/rush", {})).status, 404);
});

test("state changes are streamed live", async (t) => {
  const app = await startSystem(t, { workers: 1 });
  const abort = new AbortController();
  const response = await fetch(`${app.base}/api/events`, { signal: abort.signal });
  const reader = response.body!.getReader();
  const id = await app.create(work(50));

  let text = "";
  const decoder = new TextDecoder();
  const timer = setTimeout(() => abort.abort(), 10_000);
  while (!text.includes('"completed"')) text += decoder.decode((await reader.read()).value, { stream: true });
  clearTimeout(timer);
  abort.abort();
  for (const word of [id, '"created"', '"started"', '"completed"']) assert.ok(text.includes(word), word);
});
