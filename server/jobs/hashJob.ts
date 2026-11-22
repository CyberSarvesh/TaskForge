import { randomBytes, scrypt } from "node:crypto";
import { z } from "zod";
import { config } from "../config.ts";
import { defineJob } from "./types.ts";

const derive = (key: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(key, "taskforge", 32, { N: config.HASH_COST }, (error, derived) => (error ? reject(error) : resolve(derived)));
  });

export const hashJob = defineJob({
  title: "Derive keys",
  description: "Real CPU work: scrypt on the libuv thread pool, so heartbeats keep running.",
  timeoutMs: 20_000,
  schema: z.looseObject({ rounds: z.number().int().min(1).max(100).default(20) }),
  fields: [{ name: "rounds", label: "Rounds", kind: "number", default: 20, min: 1, max: 100 }],
  async run({ rounds }, { signal }) {
    const started = performance.now();
    let key: Buffer = randomBytes(32);
    for (let round = 0; round < rounds; round++) {
      signal.throwIfAborted();
      key = await derive(key);
    }
    return { rounds, digest: key.toString("hex"), cpuMs: Math.round(performance.now() - started) };
  },
});
