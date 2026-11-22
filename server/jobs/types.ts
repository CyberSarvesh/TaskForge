import type { z } from "zod";

export interface JobContext {
  id: string;
  attempt: number;
  /** Aborts on timeout, cancellation, lost lease and shutdown. */
  signal: AbortSignal;
}

export interface Field {
  name: string;
  label: string;
  kind: "text" | "email" | "number" | "boolean";
  default: string | number | boolean;
  min?: number;
  max?: number;
}

export interface JobDefinition<S extends z.ZodType = z.ZodType> {
  title: string;
  description: string;
  timeoutMs: number;
  schema: S;
  /** Drives the create-job form, so a new job type needs no frontend change. */
  fields: Field[];
  run(payload: z.output<S>, context: JobContext): Promise<unknown>;
}

export const defineJob = <S extends z.ZodType>(definition: JobDefinition<S>) => definition;
