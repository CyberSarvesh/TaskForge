import type { DisplayStatus, EventKind, Job } from "./types";

const number = new Intl.NumberFormat("en");
const clock = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const date = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

export const count = (value: number) => number.format(value);
export const shortId = (id: string) => id.slice(0, 8);
export const time = (value: string | number) => clock.format(new Date(value));

export const dateTime = (value: string) => {
  const when = new Date(value);
  return when.toDateString() === new Date().toDateString() ? time(value) : `${date.format(when)}, ${time(value)}`;
};

export const duration = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined) return "None yet";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
};

export const displayStatus = (job: Job): DisplayStatus =>
  job.status === "pending" && Date.parse(job.run_at) > Date.now() ? "scheduled" : job.status;

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  pending: "Queued",
  scheduled: "Waiting",
  processing: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const EVENT_LABEL: Record<EventKind, string> = {
  created: "Queued",
  scheduled: "Scheduled",
  started: "Started",
  completed: "Completed",
  retrying: "Failed, will retry",
  failed: "Failed for good",
  recovered: "Recovered from a dead worker",
  released: "Handed back",
  cancelled: "Cancelled",
  requeued: "Requeued by hand",
};
