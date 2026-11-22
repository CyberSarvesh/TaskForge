// Runs the API, a crew of workers and the Vite dev server as one command.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const server = fileURLToPath(new URL("../server/", import.meta.url));
const client = fileURLToPath(new URL("../client/", import.meta.url));
const vite = fileURLToPath(new URL("../client/node_modules/vite/bin/vite.js", import.meta.url));

if (!existsSync(vite) || !existsSync(`${server}node_modules`)) {
  console.error("Dependencies are missing. Run: npm run setup");
  process.exit(1);
}

if (existsSync(`${server}.env`)) process.loadEnvFile(`${server}.env`);

// Defaults match `npm run infra`. Anything already in the environment or server/.env wins.
const env = {
  PORT: "4000",
  PGHOST: "127.0.0.1",
  PGPORT: "55433",
  REDIS_HOST: "127.0.0.1",
  REDIS_PORT: "56380",
  DEMO_MODE: "true",
  LEASE_MS: "6000",
  ...process.env,
};

const WORKERS = Number(env.WORKERS ?? 3);
const children = new Map();
let stopping = false;

const run = (name, cwd, args, extra = {}, respawn = false) => {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...env, ...extra },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.set(name, child);

  for (const [source, sink] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    source.on("data", (data) => {
      for (const line of String(data).trimEnd().split("\n")) sink.write(`${name.padEnd(8)} ${line}\n`);
    });
  }

  child.on("exit", (code) => {
    children.delete(name);
    if (stopping) return;
    if (!respawn) {
      console.error(`${name} exited with code ${code}`);
      stop(code ?? 1);
      return;
    }
    // Long enough for a killed worker to be visibly down on the floor.
    setTimeout(() => !stopping && run(name, cwd, args, extra, respawn), 9000);
  });
};

const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const [name, child] of children) {
    if (name === "web") child.kill();
    else if (child.connected) child.send("shutdown");
  }
  const poll = setInterval(() => children.size === 0 && process.exit(code), 100);
  setTimeout(() => {
    clearInterval(poll);
    for (const child of children.values()) child.kill("SIGKILL");
    process.exit(code);
  }, 12_000);
};

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

run("api", server, ["api/server.ts"]);
for (let i = 1; i <= WORKERS; i++) {
  run(`anvil-${i}`, server, ["worker/worker.ts"], { WORKER_NAME: `anvil-${i}` }, true);
}
run("web", client, [vite], { TASKFORGE_API: `http://127.0.0.1:${env.PORT}` });

console.log("\nTaskForge is starting at http://127.0.0.1:5188 (Ctrl+C stops everything)\n");
