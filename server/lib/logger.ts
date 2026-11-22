type Fields = Record<string, unknown>;

const write = (level: "info" | "warn" | "error", message: string, fields: Fields = {}) => {
  const stream = level === "info" ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify({ time: new Date().toISOString(), level, message, ...fields })}\n`);
};

export const log = {
  info: (message: string, fields?: Fields) => write("info", message, fields),
  warn: (message: string, fields?: Fields) => write("warn", message, fields),
  error: (message: string, fields?: Fields) => write("error", message, fields),
};

export const describeError = (error: unknown): string =>
  error instanceof Error ? error.message || error.name : String(error);
