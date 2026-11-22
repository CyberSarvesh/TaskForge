import type { HistoryEvent, Job, Meta, Snapshot } from "./types";

interface ErrorBody {
  error?: string;
  details?: { path: string; message: string }[];
}

const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { signal: AbortSignal.timeout(12_000), ...init });
  } catch {
    throw new Error("Cannot reach the API.");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const { error, details } = (body ?? {}) as ErrorBody;
    const where = details?.map((item) => [item.path, item.message].filter(Boolean).join(": ")).join("; ");
    throw new Error([error ?? `The request failed (${response.status})`, where].filter(Boolean).join(". "));
  }
  return body as T;
};

const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

export const api = {
  meta: () => request<Meta>("/meta"),
  snapshot: () => request<Omit<Snapshot, "requestedAt"> & { ageMs?: number }>("/snapshot"),
  jobs: (params: URLSearchParams) => request<{ items: Job[]; nextCursor: string | null }>(`/jobs?${params}`),
  job: (id: string) => request<{ job: Job; events: HistoryEvent[] }>(`/jobs/${encodeURIComponent(id)}`),
  create: (body: unknown) => post<{ job: Job }>("/jobs", body),
  cancel: (id: string) => post<{ job: Job }>(`/jobs/${id}/cancel`),
  retry: (id: string) => post<{ job: Job }>(`/jobs/${id}/retry`),
  scenario: (name: string) => post<{ created: number }>(`/demo/scenarios/${name}`),
  crash: (id: string) => post<{ crashing: string }>(`/demo/workers/${id}/crash`),
};

export const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
