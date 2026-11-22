import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { defineJob } from "./types.ts";

const derive = promisify(scrypt);

export const hashJob = defineJob({
  title: "Derive keys",
  description: "Real CPU work: scrypt on the libuv thread pool, so heartbeats keep running.",
  timeoutMs: 20_000,
  schema: z.looseObject({ rounds: z.number().int().min(1).max(100).default(20) }),
  fields: [{ name: "rounds", label: "Rounds", kind: "number", default: 20, min: 1, max: 100 }],
  async run({ rounds }, { signal }) {
    const started = performance.now();
    let key = randomBytes(32);
    for (let round = 0; round < rounds; round++) {
      signal.throwIfAborted();
      key = (await derive(key, "taskforge", 32)) as typeof key;
    }
    return { rounds, digest: key.toString("hex"), cpuMs: Math.round(performance.now() - started) };
  },
});
