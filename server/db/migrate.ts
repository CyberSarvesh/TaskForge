import { readdir, readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { describeError, log } from "../lib/logger.ts";
import pool from "./postgres.ts";

const directory = new URL("./migrations/", import.meta.url);

export const migrate = async () => {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query("BEGIN");
    // The API and every worker migrate on boot, so only one may do it at a time.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('taskforge:migrate'))");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const applied = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const done = new Set(applied.rows.map((row) => row.name));

    for (const name of (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()) {
      if (done.has(name)) continue;
      await client.query(await readFile(new URL(name, directory), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      log.info("migration applied", { name });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => (broken = true));
    throw error;
  } finally {
    client.release(broken);
  }
};

export const migrateWithRetry = async (tries = 30) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await migrate();
    } catch (error) {
      // SQLSTATE class 22/23/42 is a bad migration or incompatible data; waiting will not fix it.
      const code = String((error as { code?: unknown }).code ?? "");
      if (attempt >= tries || /^(22|23|42)/.test(code)) throw error;
      log.warn("waiting for postgres", { attempt, error: describeError(error) });
      await sleep(1000);
    }
  }
};
