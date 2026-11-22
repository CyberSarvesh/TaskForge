import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const envFile = fileURLToPath(new URL("./.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const list = (fallback: string) =>
  z.string().default(fallback).transform((value) => value.split(",").map((item) => item.trim()).filter(Boolean));

const port = (fallback: number) => z.coerce.number().int().min(1).max(65535).default(fallback);

const schema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: port(3000),
  ALLOWED_HOSTS: list("localhost,127.0.0.1,[::1]"),
  CORS_ORIGINS: list(""),

  PGHOST: z.string().default("localhost"),
  PGPORT: port(5432),
  PGADMIN_USERNAME: z.string().default("postgres"),
  PGADMIN_PASSWORD: z.string().default("postgres"),
  PGDATABASE: z.string().default("TaskForge"),

  REDIS_HOST: z.string().default("127.0.0.1"),
  REDIS_PORT: port(6379),
  QUEUE_PREFIX: z.string().min(1).default("taskforge"),

  WORKER_NAME: z.string().min(1).max(40).optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(3),
  LEASE_MS: z.coerce.number().int().min(1000).default(10_000),
  HEARTBEAT_MS: z.coerce.number().int().min(100).default(1000),
  SWEEP_MS: z.coerce.number().int().min(100).default(1000),
  REDISPATCH_MS: z.coerce.number().int().min(500).default(5000),
  // scrypt's N. Each step down halves the CPU and memory used by one round of a hash job.
  HASH_COST: z.coerce
    .number()
    .int()
    .min(256)
    .max(16_384)
    .refine((value) => Number.isInteger(Math.log2(value)), "must be a power of two")
    .default(16_384),
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).default(8000),

  // Enables the scenario and crash-a-worker endpoints. In public, only together with PUBLIC_DEMO.
  DEMO_MODE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  // Guardrails for a demo shared by anonymous visitors: rate limits, caps, pruning, no free text.
  PUBLIC_DEMO: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  CLIENT_IP_HEADER: z.string().min(1).optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
}

export const config = parsed.data;

if (config.HEARTBEAT_MS * 2 >= config.LEASE_MS) {
  throw new Error("LEASE_MS must be more than twice HEARTBEAT_MS, or healthy jobs will lose their leases.");
}
