import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createDatabase, environment, infra } from "./helpers.ts";

// The first version had no schema file, so cover the tables someone plausibly made by hand.
const legacySchemas = {
  "uuid and jsonb": "id uuid PRIMARY KEY, type text, payload jsonb, status text, completed_at timestamp",
  "varchar and json": `id varchar(36) PRIMARY KEY, type varchar(50), payload json,
    status varchar(10) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    created_at timestamp DEFAULT now(), completed_at timestamp`,
  "text and no primary key": "id text, type text, payload text, status text, completed_at timestamptz",
};

for (const [label, columns] of Object.entries(legacySchemas)) {
  test(`upgrades a hand-made table (${label}) without losing rows`, async () => {
    const database = await createDatabase();
    const { host, port, user, password } = infra;
    const client = new pg.Client({ host, port, user, password, database: database.name });
    await client.connect();
    try {
      await client.query(`CREATE TABLE jobs (${columns})`);
      await client.query(`INSERT INTO jobs (id, type, payload, status) VALUES
        ('11111111-1111-4111-8111-111111111111', 'email', '{"to":"a@example.com"}', 'completed'),
        ('22222222-2222-4222-8222-222222222222', 'report', '{"type":"daily"}', 'processing')`);

      const run = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", `
          const { migrate } = await import('./db/migrate.ts');
          const { default: pool } = await import('./db/postgres.ts');
          await migrate();
          await migrate();
          await pool.end();`],
        {
          cwd: fileURLToPath(new URL("..", import.meta.url)),
          env: { ...process.env, ...environment(database.name) },
          encoding: "utf8",
        },
      );
      assert.equal(run.status, 0, run.stderr);

      const { rows } = await client.query("SELECT status, payload, attempts FROM jobs ORDER BY id");
      assert.deepEqual(rows, [
        { status: "completed", payload: { to: "a@example.com" }, attempts: 0 },
        { status: "processing", payload: { type: "daily" }, attempts: 0 },
      ]);
      await client.query("UPDATE jobs SET status = 'cancelled'"); // the old check constraint must be gone
    } finally {
      await client.end();
      await database.drop();
    }
  });
}
