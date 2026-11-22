import { describeError, log } from "./logger.ts";

export const onShutdown = (stop: () => Promise<void>) => {
  let stopping = false;
  const run = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await stop();
      process.exit(0);
    } catch (error) {
      log.error("shutdown failed", { error: describeError(error) });
      process.exit(1);
    }
  };
  process.on("SIGINT", run);
  process.on("SIGTERM", run);
  // Windows has no real SIGTERM, so a parent process asks over IPC instead.
  process.on("message", (message) => {
    if (message === "shutdown") void run();
  });
  if (process.send) process.on("disconnect", run);
};
