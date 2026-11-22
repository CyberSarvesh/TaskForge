import { query } from "../db/postgres.ts";

interface Heartbeat {
  id: string;
  name: string;
  pid: number;
  concurrency: number;
  active: string[];
}

export const heartbeat = async ({ id, name, pid, concurrency, active }: Heartbeat) =>
  (await query<{ crash_requested: boolean }>(
    `INSERT INTO workers (id, name, pid, concurrency, active) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET active = EXCLUDED.active, last_seen = now()
     RETURNING crash_requested`,
    [id, name, pid, concurrency, active],
  )).rows[0]!.crash_requested;

export const unregister = (id: string) => query("DELETE FROM workers WHERE id = $1", [id]);

// DISTINCT ON keeps one machine per name, so a restarted worker replaces its dead predecessor.
export const listWorkers = async () =>
  (await query(
    `SELECT * FROM (
       SELECT DISTINCT ON (name) id, name, pid, concurrency, active, started_at, last_seen,
         (last_seen > now() - interval '3 seconds' AND NOT crash_requested) AS online
       FROM workers WHERE last_seen > now() - interval '30 seconds'
       ORDER BY name, started_at DESC
     ) latest ORDER BY name`,
  )).rows;

export const requestCrash = async (id: string) =>
  (await query(
    `UPDATE workers SET crash_requested = true
     WHERE id = $1 AND NOT crash_requested AND last_seen > now() - interval '3 seconds'`,
    [id],
  )).rowCount === 1;
