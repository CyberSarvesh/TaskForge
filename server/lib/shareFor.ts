/**
 * Lets simultaneous and closely following callers share one result, so a hundred viewers cost
 * one set of queries. `ageMs` says how old the answer is.
 */
export const shareFor = <T>(ttlMs: number, load: () => Promise<T>) => {
  let cached: { startedAt: number; settled: boolean; value: Promise<T> } | undefined;

  return async () => {
    if (!cached || (cached.settled && Date.now() - cached.startedAt >= ttlMs)) {
      const entry = { startedAt: Date.now(), settled: false, value: load() };
      cached = entry;
      entry.value.then(
        () => (entry.settled = true),
        () => {
          if (cached === entry) cached = undefined;
        },
      );
    }
    const { startedAt, value } = cached;
    const ageMs = Date.now() - startedAt;
    return { value: await value, ageMs };
  };
};
