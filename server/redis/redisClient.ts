import { Redis } from "ioredis";
import type { RedisOptions } from "ioredis";
import { config } from "../config.ts";
import { log } from "../lib/logger.ts";

export const createRedis = (role: string, options: RedisOptions = {}) => {
  const client = new Redis({
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    // Fail fast. Postgres already has the job, so there is never a reason to hang on Redis.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: 1000,
    retryStrategy: (times) => Math.min(times * 200, 2000),
    ...options,
  });

  let down = false;
  client.on("ready", () => {
    down = false;
    log.info("redis ready", { role });
  });
  client.on("error", (error) => {
    if (!down) log.warn("redis unavailable", { role, error: error.message });
    down = true;
  });
  return client;
};
