import { buildJob } from "./jobService.ts";

const repeat = <T>(count: number, make: (index: number) => T) => Array.from({ length: count }, (_, i) => make(i));

const scenarios = {
  mixed: {
    title: "Mixed shift",
    description: "12 jobs of every kind",
    jobs: () => repeat(12, (i) => [
      { type: "email", payload: { to: `user${i}@example.com` } },
      { type: "report", payload: { type: `shift-${i}` } },
      { type: "hash", payload: { rounds: 25 } },
      { type: "fault", payload: { durationMs: 1200, failTimes: i === 3 ? 1 : 0 } },
    ][i % 4]!),
  },
  rush: {
    title: "Rush order",
    description: "60 jobs at once, to show backpressure",
    jobs: () => repeat(60, (i) => ({ type: "fault", payload: { durationMs: 900 + (i % 7) * 150, failTimes: 0 } })),
  },
  flaky: {
    title: "Flaky upstream",
    description: "10 jobs that fail, back off and retry",
    jobs: () => repeat(10, (i) => ({
      type: "fault",
      maxAttempts: 4,
      payload: { durationMs: 900, failTimes: 1 + (i % 3) },
    })),
  },
  poison: {
    title: "Bad batch",
    description: "6 jobs that end as scrap",
    jobs: () => repeat(6, (i) => ({
      type: "fault",
      maxAttempts: 2,
      payload: i % 2 ? { durationMs: 700, permanent: true } : { durationMs: 700, failTimes: 5 },
    })),
  },
  priority: {
    title: "Queue jump",
    description: "20 low, then 5 high that overtake",
    jobs: () => repeat(25, (i) => ({
      type: "fault",
      priority: i < 20 ? "low" : "high",
      payload: { durationMs: 1400, failTimes: 0 },
    })),
  },
};

export const scenarioNames = Object.keys(scenarios) as [keyof typeof scenarios, ...(keyof typeof scenarios)[]];
export const describeScenarios = () =>
  Object.entries(scenarios).map(([name, { title, description }]) => ({ name, title, description }));
export const scenarioJobs = (name: keyof typeof scenarios) => scenarios[name].jobs().map((job) => buildJob(job));
