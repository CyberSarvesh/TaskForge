export const PRIORITIES = ["high", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

const PRIORITY_OFFSET_MS: Record<Priority, number> = { high: -60_000, normal: 0, low: 60_000 };

/**
 * Lower scores run first. Priority is a head start measured in time, so it ages:
 * a low-priority job that has waited over two minutes beats a brand new high-priority one,
 * which means a steady stream of urgent work cannot starve the rest.
 */
export const queueScore = (priority: Priority, runAt: Date) => runAt.getTime() + PRIORITY_OFFSET_MS[priority];

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

/** Exponential backoff with "equal jitter": always at least half the delay, never in lockstep. */
export const retryDelay = (attempt: number, random: () => number = Math.random) => {
  const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(delay / 2 + random() * (delay / 2));
};
