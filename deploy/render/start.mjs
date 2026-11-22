// Process supervisor for the single-container demo: Postgres, Redis, the API and three workers.
// If a service that cannot be lost dies, the container exits and the platform starts a clean one.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

const server = "/app/server";
const port = process.env.PORT || "10000";
const RESPAWN_MS = 4000;

const hosts = ["localhost", "127.0.0.1", process.env.RENDER_EXTERNAL_HOSTNAME, process.env.EXTRA_HOSTS];
const env = { ...process.env, PORT: port, ALLOWED_HOSTS: hosts.filter(Boolean).join(",").toLowerCase() };

const children = new Map();
let stopping = false;

const start = (name, command, args, { signal = "SIGTERM", respawn = false, extra = {} } = {}) => {
  const child = spawn(command, args, { cwd: server, env: { ...env, ...extra }, stdio: "inherit" });
  children.set(name, { child, signal });

  child.on("error", (error) => {
    console.error(`cannot start ${name}: ${error.message}`);
    void stop(1);
  });
  child.on("exit", (code) => {
    children.delete(name);
    if (stopping) return;
    if (respawn) {
      setTimeout(() => !stopping && start(name, command, args, { signal, respawn, extra }), RESPAWN_MS);
    } else {
      console.error(`${name} exited with code ${code}; stopping the container`);
      void stop(1);
    }
  });
};

const stop = async (code = 0) => {
  if (stopping) return;
  stopping = true;

  const end = async (names, withinMs) => {
    for (const name of names) children.get(name)?.child.kill(children.get(name).signal);
    const deadline = Date.now() + withinMs;
    while (names.some((name) => children.has(name)) && Date.now() < deadline) await sleep(100);
    for (const name of names) children.get(name)?.child.kill("SIGKILL");
  };

  // Applications first, so they can hand their jobs back while the databases are still there.
  await end([...children.keys()].filter((name) => name !== "postgres" && name !== "redis"), 18_000);
  await end(["postgres", "redis"], 7000);
  process.exit(code);
};

const listening = (onPort) =>
  new Promise((resolve) => {
    const socket = net.connect(Number(onPort), "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });

const waitFor = async (onPort) => {
  while (!stopping && !(await listening(onPort))) await sleep(250);
};

process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());

// Left behind by an unclean stop. Nothing else in this container can own the data directory.
rmSync("/data/postmaster.pid", { force: true });

// Nothing here outlives the container, so durability is traded for speed on a tenth of a CPU.
const settings = [
  "listen_addresses=127.0.0.1", "max_connections=60", "shared_buffers=16MB", "jit=off",
  "fsync=off", "synchronous_commit=off", "full_page_writes=off",
  "min_wal_size=32MB", "max_wal_size=64MB",
];
start("postgres", "postgres", ["-D", "/data", ...settings.flatMap((setting) => ["-c", setting])], { signal: "SIGINT" });
start("redis", "redis-server", [
  "--bind", "127.0.0.1", "--save", "", "--appendonly", "no",
  "--maxmemory", "25mb", "--maxmemory-policy", "noeviction", "--loglevel", "warning",
]);
await Promise.all([waitFor(5432), waitFor(6379)]);

// The API gets the CPU to itself until it is listening, because the platform is waiting on that port.
if (!stopping) start("api", process.execPath, ["api/server.ts"]);
await waitFor(port);

for (let i = 1; i <= 3 && !stopping; i++) {
  start(`anvil-${i}`, process.execPath, ["worker/worker.ts"], { respawn: true, extra: { WORKER_NAME: `anvil-${i}` } });
}
