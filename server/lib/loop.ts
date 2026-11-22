import { describeError, log } from "./logger.ts";

/** Like setInterval, except runs never overlap, errors never escape, and stop() waits. */
export const every = (ms: number, name: string, task: () => Promise<void>) => {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let current: Promise<void> = Promise.resolve();

  const tick = () => {
    current = task()
      .catch((error) => log.warn(`${name} failed`, { error: describeError(error) }))
      .then(() => {
        if (!stopped) timer = setTimeout(tick, ms);
      });
  };
  tick();

  return async () => {
    stopped = true;
    clearTimeout(timer);
    await current;
  };
};
