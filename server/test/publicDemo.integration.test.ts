import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { startSystem, until } from "./helpers.ts";

const publicApp = async (t: TestContext, workers = 0) => {
  const app = await startSystem(t, { workers, env: { PUBLIC_DEMO: "true", CLIENT_IP_HEADER: "x-test-ip" } });
  let visitor = 0;
  // Each call is a different visitor unless the test says otherwise.
  const post = (path: string, body: unknown = {}, ip = `10.0.${visitor >> 8}.${visitor++ & 255}`) =>
    app.call(path, body, { "x-test-ip": ip });
  return { ...app, post };
};

test("public: typed text and unknown fields are never stored", async (t) => {
  const app = await publicApp(t);
  const secret = "private.person@example.com";
  const bodies = [
    ["/api/jobs", { type: "email", payload: { to: secret, subject: secret, note: secret } }],
    ["/jobs", { type: "email", payload: { to: secret } }],
    ["/api/jobs", { type: "report", payload: { type: secret, [secret]: 1 } }],
    ["/api/jobs", { type: "hash", payload: { rounds: 1, note: secret } }],
  ] as const;
  for (const [index, [path, body]] of bodies.entries()) {
    const headers = { "x-test-ip": `10.1.0.${index}`, "Idempotency-Key": `${secret}-${index}` };
    assert.ok((await app.call(path, body, headers)).status < 300);
  }

  const { rows } = await app.db.query("SELECT * FROM jobs");
  assert.equal(rows.length, bodies.length);
  assert.ok(!JSON.stringify(rows).includes(secret));
  assert.ok(!(await app.call("/api/jobs")).text.includes(secret));
});

test("public: expensive jobs are refused", async (t) => {
  const app = await publicApp(t);
  const refused = [
    { type: "hash", payload: { rounds: 26 } },
    { type: "fault", payload: { durationMs: 10_001 } },
    { type: "report", maxAttempts: 6 },
    { type: "report", delayMs: 60_001 },
  ];
  for (const body of refused) assert.equal((await app.post("/api/jobs", body)).status, 400);
  assert.equal((await app.post("/api/jobs", { type: "report", junk: "x".repeat(9000) })).status, 413);
});

test("public: every scenario still runs", async (t) => {
  for (const name of ["mixed", "rush", "flaky", "poison", "priority"]) {
    const app = await publicApp(t);
    assert.equal((await app.post(`/api/demo/scenarios/${name}`)).status, 202, name);
  }
});

test("public: the active job cap holds under simultaneous requests", async (t) => {
  const app = await publicApp(t);
  const replies = await Promise.all(Array.from({ length: 8 }, () => app.post("/api/demo/scenarios/rush")));
  assert.equal(replies.filter((reply) => reply.status === 202).length, 2);
  assert.equal(replies.filter((reply) => reply.body.code === "demo_full").length, 6);
  assert.equal((await app.db.query("SELECT count(*)::int AS n FROM jobs")).rows[0].n, 120);
});

test("public: finished jobs are pruned, live ones never", async (t) => {
  const app = await publicApp(t);
  await app.db.query(
    "INSERT INTO jobs (id, type, payload, status) SELECT gen_random_uuid(), 'report', '{}', 'pending' FROM generate_series(1, 5)",
  );
  await app.db.query(
    "INSERT INTO jobs (id, type, payload, status) SELECT gen_random_uuid(), 'report', '{}', 'completed' FROM generate_series(1, 1010)",
  );
  await until(
    async () => (await app.db.query("SELECT 1 FROM jobs WHERE status = 'completed'")).rowCount === 1000,
    "pruning", 45_000,
  );
  assert.equal((await app.db.query("SELECT 1 FROM jobs WHERE status = 'pending'")).rowCount, 5);
});

test("public: requeueing respects the cap", async (t) => {
  const app = await publicApp(t);
  await app.db.query(
    "INSERT INTO jobs (id, type, payload, status) SELECT gen_random_uuid(), 'report', '{}', 'pending' FROM generate_series(1, 150)",
  );
  const { rows } = await app.db.query(
    "INSERT INTO jobs (id, type, payload, status) VALUES (gen_random_uuid(), 'report', '{}', 'failed') RETURNING id",
  );
  assert.equal((await app.post(`/api/jobs/${rows[0].id}/retry`)).body.code, "demo_full");
});

test("public: one address is limited without affecting another", async (t) => {
  const app = await publicApp(t);
  const statuses = [];
  for (let i = 0; i < 22; i++) statuses.push((await app.post("/api/jobs", { type: "report" }, "203.0.113.9")).status);
  assert.ok(statuses.filter((status) => status === 429).length >= 3, statuses.join());
  assert.equal((await app.post("/api/jobs", { type: "report" }, "198.51.100.4")).status, 202);
});

test("public: health answers any Host and is never rate limited", async (t) => {
  const app = await publicApp(t);
  const headers = { "x-test-ip": "203.0.113.50" };
  const replies = await Promise.all(Array.from({ length: 200 }, () => app.call("/api/health", undefined, headers)));
  assert.ok(replies.every((reply) => reply.status === 200));
});

test("public: a burst of lookups cannot take the database from other visitors", async (t) => {
  const app = await publicApp(t);
  const from = (ip: string) => app.call("/api/jobs", undefined, { "x-test-ip": ip });
  const burst = await Promise.all(Array.from({ length: 80 }, () => from("203.0.113.20")));
  assert.ok(burst.some((reply) => reply.body.code === "busy"));
  assert.equal((await from("198.51.100.20")).status, 200, "another visitor is served");
});

test("public: one address cannot hold every live stream", async (t) => {
  const app = await publicApp(t);
  const abort = new AbortController();
  const open = (ip: string) => fetch(`${app.base}/api/events`, { signal: abort.signal, headers: { "x-test-ip": ip } });
  for (let i = 0; i < 8; i++) assert.equal((await open("203.0.113.7")).status, 200);
  assert.equal((await open("203.0.113.7")).status, 429);
  assert.equal((await open("198.51.100.7")).status, 200);
  abort.abort();
});

test("public: only one worker can be killed at a time", async (t) => {
  const app = await publicApp(t, 3);
  const workers = await until(async () => {
    const { body } = await app.call("/api/snapshot");
    return body.workers.length === 3 && body.workers;
  }, "three workers");
  assert.equal((await app.post(`/api/demo/workers/${workers[0].id}/crash`)).status, 202);
  assert.equal((await app.post(`/api/demo/workers/${workers[1].id}/crash`)).body.code, "crash_cooldown");
});
