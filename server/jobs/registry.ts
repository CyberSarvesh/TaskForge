import { emailJob } from "./emailJob.ts";
import { faultJob } from "./faultJob.ts";
import { hashJob } from "./hashJob.ts";
import { reportJob } from "./reportJob.ts";
import type { JobDefinition } from "./types.ts";

// To add a job type, write a handler and add one line here. The API validation and UI form follow.
const registry = new Map<string, JobDefinition<any>>([
  ["email", emailJob],
  ["report", reportJob],
  ["hash", hashJob],
  ["fault", faultJob],
]);

export const getDefinition = (type: string) => registry.get(type);

export const describeJobTypes = () =>
  [...registry].map(([type, { title, description, timeoutMs, fields }]) => ({
    type, title, description, timeoutMs, fields,
  }));
