export type Priority = "high" | "normal" | "low";
export type Status = "pending" | "processing" | "completed" | "failed" | "cancelled";
export type DisplayStatus = Status | "scheduled";

export interface Job {
  id: string;
  seq: string;
  type: string;
  payload: unknown;
  status: Status;
  priority: Priority;
  attempts: number;
  max_attempts: number;
  run_at: string;
  worker: string | null;
  result: unknown;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export type EventKind =
  | "created" | "scheduled" | "started" | "completed" | "retrying"
  | "failed" | "recovered" | "released" | "cancelled" | "requeued";

export interface LiveEvent {
  id: number;
  jobId: string;
  kind: EventKind;
  type: string;
  priority: Priority;
  attempt: number;
  worker: string | null;
  detail: string | null;
  at: string;
}

export interface HistoryEvent {
  id: string;
  kind: EventKind;
  attempt: number;
  worker: string | null;
  detail: string | null;
  wait_ms: number | null;
  run_ms: number | null;
  at: string;
}

export interface Worker {
  id: string;
  name: string;
  pid: number;
  concurrency: number;
  active: string[];
  online: boolean;
}

export interface FloorJob {
  id: string;
  type: string;
  priority: Priority;
  state: "pending" | "scheduled" | "processing";
  worker: string | null;
  attempts: number;
}

export interface Snapshot {
  at: number;
  /** performance.now() when the request left, used to ignore stale answers. */
  requestedAt: number;
  windowSeconds: number;
  bucketSeconds: number;
  counts: Record<DisplayStatus, number>;
  series: { t: number; completed: number; errors: number }[];
  latency: Record<"wait_p50" | "wait_p95" | "run_p50" | "run_p95", number | null>;
  types: { type: string; completed: number; run_p50: number | null }[];
  workers: Worker[];
  floor: FloorJob[];
  redis: { up: boolean; depth: number | null };
}

export interface Field {
  name: string;
  label: string;
  kind: "text" | "email" | "number" | "boolean";
  default: string | number | boolean;
  min?: number;
  max?: number;
  /** The public demo does not accept typed text. */
  locked?: boolean;
}

export interface Meta {
  demo: boolean;
  publicDemo: boolean;
  leaseMs: number;
  types: { type: string; title: string; description: string; timeoutMs: number; fields: Field[] }[];
  scenarios: { name: string; title: string; description: string }[];
}
