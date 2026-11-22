import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { Redis } from "ioredis";
import { config } from "../config.ts";
import { PermanentError } from "../lib/errors.ts";
import { describeError, log } from "../lib/logger.ts";
import { every } from "../lib/loop.ts";
import { retryDelay } from "../lib/policy.ts";
import * as store from "../services/jobStore.ts";
import { enqueue, takeNext } from "../services/queueService.ts";
import { heartbeat, unregister } from "../services/workerStore.ts";
import { execute } from "./execute.ts";

interface Running {
  job: store.Job;
  token: string;
  controller: AbortController;
  done: Promise<void>;
}

interface Options {
  id: string;
  name: string;
  redis: Redis;
  blockingRedis: Redis;
}

/**
 * Three independent loops:
 *   consume   - pull ids while a slot is free, then try to claim them in Postgres
 *   heartbeat - renew leases and notice cancellations
 *   sweep     - recover dead workers' jobs and re-dispatch anything Redis may have lost
 *
 * Every worker sweeps. SKIP LOCKED lets them do so concurrently without a leader election.
 */
export class WorkerRuntime {
  #options: Options;
  #running = new Map<string, Running>();
  #slotFreed: (() => void) | undefined;
  #stopping = false;
  #stops: (() => Promise<void>)[] = [];
  #consumer: Promise<void> | undefined;

  constructor(options: Options) {
    this.#options = options;
  }

  start() {
    this.#stops = [
      every(config.HEARTBEAT_MS, "heartbeat", () => this.#beat()),
      every(config.SWEEP_MS, "sweep", () => this.#sweep()),
    ];
    this.#consumer = this.#consume();
  }

  async #consume() {
    while (!this.#stopping) {
      if (this.#running.size >= config.WORKER_CONCURRENCY) {
        await new Promise<void>((resolve) => (this.#slotFreed = resolve));
        continue;
      }
      try {
        const id = await takeNext(this.#options.blockingRedis);
        // An id popped and not claimed is harmless: the sweeper will dispatch it again.
        if (!id || this.#stopping) continue;
        const token = randomUUID();
        const job = await store.claimJob(id, this.#options.name, token, config.LEASE_MS);
        if (job) this.#run(job, token);
      } catch (error) {
        if (this.#stopping) break;
        // Redis outages are already logged once by the client, so only report the others.
        if (this.#options.blockingRedis.status === "ready") {
          log.warn("consume failed", { error: describeError(error) });
        }
        await sleep(500);
      }
    }
  }

  #run(job: store.Job, token: string) {
    const controller = new AbortController();
    const done = this.#process(job, token, controller.signal)
      .catch((error) => log.error("could not record job outcome", { job: job.id, error: describeError(error) }))
      .finally(() => {
        this.#running.delete(token);
        this.#slotFreed?.();
      });
    this.#running.set(token, { job, token, controller, done });
  }

  async #process(job: store.Job, token: string, signal: AbortSignal) {
    let result: unknown;
    try {
      result = await execute(job, signal);
    } catch (error) {
      if (signal.aborted) return; // whoever aborted owns the next transition
      const final = error instanceof PermanentError || job.attempts >= job.max_attempts;
      const delay = final ? null : retryDelay(job.attempts);
      const message = describeError(error).replaceAll("\u0000", "").slice(0, 1000);
      await store.failJob(job.id, token, message, delay);
      return;
    }
    if (!(await store.completeJob(job.id, token, result))) {
      log.warn("result discarded, lease no longer held", { job: job.id });
    }
  }

  async #beat() {
    const { id, name } = this.#options;
    const held = [...this.#running.values()];
    if (held.length) {
      const valid = await store.renewLeases(held.map((item) => item.token), config.LEASE_MS);
      for (const { token, controller } of held) {
        if (!valid.has(token)) controller.abort(new Error("Lease lost or job cancelled"));
      }
    }
    const crash = await heartbeat({
      id,
      name,
      pid: process.pid,
      concurrency: config.WORKER_CONCURRENCY,
      active: held.map((item) => item.job.id),
    });
    if (crash && config.DEMO_MODE) {
      log.warn("crash requested, exiting without cleanup", { name });
      process.exit(137);
    }
  }

  async #sweep() {
    const recovered = await store.recoverExpiredLeases();
    if (recovered) log.warn("recovered expired leases", { count: recovered });
    const { redis } = this.#options;
    // Marking jobs as dispatched while Redis is down would only delay them after it returns.
    if (redis.status !== "ready") return;
    await enqueue(redis, await store.takeDispatchable(config.REDISPATCH_MS));
  }

  async stop() {
    this.#stopping = true;
    this.#slotFreed?.();
    await this.#consumer;

    // Keep heartbeating while draining, or the jobs being drained would lose their leases.
    const jobs = [...this.#running.values()];
    const drained = Promise.all(jobs.map((item) => item.done));
    await Promise.race([drained, sleep(config.SHUTDOWN_GRACE_MS)]);

    await Promise.all(this.#stops.map((stop) => stop()));
    await Promise.all(
      [...this.#running.values()].map(async ({ job, token, controller }) => {
        controller.abort(new Error("Worker shutting down"));
        await store.releaseJob(job.id, token);
      }),
    );
    await unregister(this.#options.id);
  }
}
