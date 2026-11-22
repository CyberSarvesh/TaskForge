import { config } from "../config.ts";
import { migrateWithRetry } from "../db/migrate.ts";
import pool from "../db/postgres.ts";
import { onShutdown } from "../lib/lifecycle.ts";
import { log } from "../lib/logger.ts";
import { every } from "../lib/loop.ts";
import { createRedis } from "../redis/redisClient.ts";
import { EventStream } from "../services/eventStream.ts";
import { prune } from "../services/publicDemo.ts";
import { createApp } from "./app.ts";

await migrateWithRetry();

const redis = createRedis("api");
const events = new EventStream();
await events.start();
const stopPruning = config.PUBLIC_DEMO ? every(30_000, "prune", prune) : undefined;

const server = createApp(redis, events).listen(config.PORT, config.HOST, (error?: Error) => {
  if (error) {
    log.error("cannot listen", { port: config.PORT, error: error.message });
    process.exit(1);
  }
  log.info("api listening", { url: `http://${config.HOST}:${config.PORT}`, demo: config.DEMO_MODE });
});

onShutdown(async () => {
  const closed = new Promise((resolve) => server.close(resolve));
  await stopPruning?.();
  await events.stop();
  setTimeout(() => server.closeAllConnections(), 3000).unref();
  await closed;
  redis.disconnect();
  await pool.end();
});
