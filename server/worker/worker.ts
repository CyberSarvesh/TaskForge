import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { config } from "../config.ts";
import { migrateWithRetry } from "../db/migrate.ts";
import pool from "../db/postgres.ts";
import { onShutdown } from "../lib/lifecycle.ts";
import { log } from "../lib/logger.ts";
import { createRedis } from "../redis/redisClient.ts";
import { WorkerRuntime } from "./runtime.ts";

await migrateWithRetry();

const redis = createRedis("worker");
// Blocking pops occupy their connection, so they get one of their own.
const blockingRedis = createRedis("worker-blocking", { commandTimeout: 5000 });
const id = randomUUID();
const name = config.WORKER_NAME ?? `${hostname().slice(0, 12)}-${id.slice(0, 4)}`;

const worker = new WorkerRuntime({ id, name, redis, blockingRedis });
worker.start();
log.info("worker started", { name, concurrency: config.WORKER_CONCURRENCY });

onShutdown(async () => {
  await worker.stop();
  redis.disconnect();
  blockingRedis.disconnect();
  await pool.end();
});
