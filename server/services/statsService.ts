import type { Redis } from "ioredis";
import { query } from "../db/postgres.ts";
import { queueDepth } from "./queueService.ts";
import { listWorkers } from "./workerStore.ts";

export const WINDOW_SECONDS = 300;
const BUCKET_SECONDS = 5;

export const getSnapshot = async (redis: Redis) => {
  const [counts, series, latency, types, workers, floor, depth] = await Promise.all([
    query(
      `SELECT count(*) FILTER (WHERE status = 'pending' AND run_at <= now())::int AS pending,
              count(*) FILTER (WHERE status = 'pending' AND run_at > now())::int  AS scheduled,
              count(*) FILTER (WHERE status = 'processing')::int AS processing,
              count(*) FILTER (WHERE status = 'completed')::int  AS completed,
              count(*) FILTER (WHERE status = 'failed')::int     AS failed,
              count(*) FILTER (WHERE status = 'cancelled')::int  AS cancelled
       FROM jobs`,
    ),
    query(
      `WITH edge AS (SELECT floor(extract(epoch FROM now()) / $2::int)::bigint * $2::int AS t),
       found AS (
         SELECT floor(extract(epoch FROM at) / $2::int)::bigint * $2::int AS t,
                count(*) FILTER (WHERE kind = 'completed')::int AS completed,
                count(*) FILTER (WHERE kind IN ('failed', 'retrying', 'recovered'))::int AS errors
         FROM job_events WHERE at > now() - $1::int * interval '1 second'
         GROUP BY 1
       )
       SELECT s.t::float8 * 1000 AS t, COALESCE(completed, 0) AS completed, COALESCE(errors, 0) AS errors
       FROM edge, generate_series(edge.t - $1::int + $2::int, edge.t, $2::int) AS s(t)
       LEFT JOIN found ON found.t = s.t
       ORDER BY s.t`,
      [WINDOW_SECONDS, BUCKET_SECONDS],
    ),
    query(
      `SELECT percentile_cont(0.5)  WITHIN GROUP (ORDER BY wait_ms) AS wait_p50,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY wait_ms) AS wait_p95,
              percentile_cont(0.5)  WITHIN GROUP (ORDER BY run_ms) FILTER (WHERE kind = 'completed') AS run_p50,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY run_ms) FILTER (WHERE kind = 'completed') AS run_p95
       FROM job_events WHERE at > now() - $1::int * interval '1 second'`,
      [WINDOW_SECONDS],
    ),
    query(
      `SELECT j.type, count(*)::int AS completed, percentile_cont(0.5) WITHIN GROUP (ORDER BY e.run_ms) AS run_p50
       FROM job_events e JOIN jobs j ON j.id = e.job_id
       WHERE e.kind = 'completed' AND e.at > now() - $1::int * interval '1 second'
       GROUP BY 1 ORDER BY 2 DESC, 1`,
      [WINDOW_SECONDS],
    ),
    listWorkers(),
    // What the factory floor draws. Capped, because nobody can look at 10,000 ingots.
    query(
      `(SELECT id, type, priority, 'processing' AS state, worker, attempts FROM jobs
         WHERE status = 'processing' ORDER BY started_at LIMIT 100)
       UNION ALL
       (SELECT id, type, priority, CASE WHEN run_at > now() THEN 'scheduled' ELSE 'pending' END, NULL, attempts
         FROM jobs WHERE status = 'pending' ORDER BY run_at LIMIT 150)`,
    ),
    queueDepth(redis).catch(() => null),
  ]);

  return {
    at: Date.now(),
    windowSeconds: WINDOW_SECONDS,
    bucketSeconds: BUCKET_SECONDS,
    counts: counts.rows[0],
    series: series.rows,
    latency: latency.rows[0],
    types: types.rows,
    workers,
    floor: floor.rows,
    redis: { up: depth !== null, depth },
  };
};
