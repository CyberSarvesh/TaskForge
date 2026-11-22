import pg from "pg";
import type { QueryResultRow } from "pg";
import { config } from "../config.ts";
import { describeError, log } from "../lib/logger.ts";

export const connection = {
  host: config.PGHOST,
  port: config.PGPORT,
  user: config.PGADMIN_USERNAME,
  password: config.PGADMIN_PASSWORD,
  database: config.PGDATABASE,
  connectionTimeoutMillis: 3000,
  keepAlive: true,
};

const pool = new pg.Pool({ ...connection, max: 10, query_timeout: 10_000 });

// Without these listeners, a database restart is an uncaught exception that kills the process.
// The pool one covers idle clients; the client one covers clients that are checked out.
pool.on("error", (error) => log.warn("postgres connection lost", { error: describeError(error) }));
pool.on("connect", (client) => {
  client.on("error", (error) => log.warn("postgres client error", { error: describeError(error) }));
});

export const query = <T extends QueryResultRow = any>(text: string, params?: unknown[]) =>
  pool.query<T>(text, params);

export default pool;
