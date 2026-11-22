import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import net from "node:net";
import type { TestContext } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Redis } from "ioredis";
import pg from "pg";

// Defaults match `npm run infra` at the repository root. Every test gets its own database and prefix.
// The usual PG* and REDIS_* variables are ignored on purpose: these tests create and drop databases,
// and a PGPORT in someone's shell must not point them at that person's own server.
export const infra = {
  host: process.env.TEST_PGHOST ?? "127.0.0.1",
  port: Number(process.env.TEST_PGPORT ?? 55433),
  user: process.env.TEST_PGUSER ?? "postgres",
  password: process.env.TEST_PGPASSWORD ?? "postgres",
  redisHost: process.env.TEST_REDIS_HOST ?? "127.0.0.1",
  redisPort: Number(process.env.TEST_REDIS_PORT ?? 56380),
};

const serverDir = fileURLToPath(new URL("..", import.meta.url));

export const createDatabase = async () => {
  const name = `taskforge_test_${randomBytes(6).toString("hex")}`;
  const { host, port, user, password } = infra;
  const admin = new pg.Client({ host, port, user, password, database: "postgres" });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  return {
    name,
    async drop() {
      const client = new pg.Client({ host, port, user, password, database: "postgres" });
      await client.connect();
      await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await client.end();
    },
  };
};

export const environment = (database: string) => ({
  PGHOST: infra.host,
  PGPORT: String(infra.port),
  PGADMIN_USERNAME: infra.user,
  PGADMIN_PASSWORD: infra.password,
  PGDATABASE: database,
  REDIS_HOST: infra.redisHost,
  REDIS_PORT: String(infra.redisPort),
  QUEUE_PREFIX: database,
});

export const until = async <T>(check: () => Promise<T | false | undefined | null>, what: string, timeout = 15_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
};

const freePort = async () => {
  const server = net.createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;
  server.close();
  await once(server, "close");
  return port;
};

/** A TCP proxy in front of Redis, so a test can cause an outage without touching the server. */
const flakyLink = async () => {
  let up = true;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((incoming) => {
    if (!up) return void incoming.destroy();
    const outgoing = net.connect(infra.redisPort, infra.redisHost);
    for (const socket of [incoming, outgoing]) {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.on("close", () => {
        sockets.delete(socket);
        incoming.destroy();
        outgoing.destroy();
      });
    }
    incoming.pipe(outgoing).pipe(incoming);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const cut = () => {
    up = false;
    for (const socket of sockets) socket.destroy();
  };
  return {
    port: (server.address() as net.AddressInfo).port,
    cut,
    restore: () => void (up = true),
    close() {
      cut();
      server.close();
    },
  };
};

/** Boots a real API and real worker processes. */
export const startSystem = async (t: TestContext, options: { workers?: number; env?: Record<string, string> } = {}) => {
  const database = await createDatabase();
  const link = await flakyLink();
  const port = await freePort();
  const children: ChildProcess[] = [];
  const base = `http://127.0.0.1:${port}`;
  let output = "";

  const env = {
    ...process.env,
    ...environment(database.name),
    REDIS_HOST: "127.0.0.1",
    REDIS_PORT: String(link.port),
    HOST: "127.0.0.1",
    PORT: String(port),
    DEMO_MODE: "true",
    LEASE_MS: "2000",
    HEARTBEAT_MS: "250",
    SWEEP_MS: "250",
    REDISPATCH_MS: "1000",
    ...options.env,
  };

  const start = (script: string, extra: Record<string, string> = {}) => {
    const child = spawn(process.execPath, [script], {
      cwd: serverDir,
      env: { ...env, ...extra },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    child.stdout!.on("data", (data) => (output += data));
    child.stderr!.on("data", (data) => (output += data));
    children.push(child);
    return child;
  };

  const db = new pg.Pool({
    host: infra.host, port: infra.port, user: infra.user, password: infra.password, database: database.name, max: 3,
  });
  db.on("error", () => {});
  const redis = new Redis({ host: infra.redisHost, port: infra.redisPort });

  t.after(async () => {
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      child.kill("SIGKILL");
      await once(child, "exit");
    }
    if (process.env.TEST_LOGS) process.stderr.write(output);
    link.close();
    await db.end();
    await redis.del(`${database.name}:ready`);
    redis.disconnect();
    await database.drop();
  });

  const api = start("api/server.ts");
  await until(() => fetch(`${base}/api/health`).then(() => true, () => false), "the API");

  let count = 0;
  const addWorker = async (extra: Record<string, string> = {}) => {
    const name = `w${++count}`;
    const child = start("worker/worker.ts", { WORKER_NAME: name, ...extra });
    await until(async () => (await db.query("SELECT 1 FROM workers WHERE name = $1", [name])).rowCount, name);
    return { name, child };
  };
  const workers = [];
  for (let i = 0; i < (options.workers ?? 0); i++) workers.push(await addWorker());

  const call = async (path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(base + path, body === undefined ? { headers } : {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, text, body: text.startsWith("{") ? JSON.parse(text) : null };
  };

  const create = async (job: object) => {
    const response = await call("/api/jobs", job);
    if (response.status !== 202) throw new Error(`create failed: ${response.text}`);
    return response.body.job.id as string;
  };

  const waitFor = (id: string, status: string, timeout?: number) =>
    until(async () => {
      const { body } = await call(`/api/jobs/${id}`);
      return body?.job?.status === status && body;
    }, `${id} to be ${status}`, timeout);

  return { base, port, api, db, redis, link, database, workers, addWorker, call, create, waitFor };
};
