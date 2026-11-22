import type { ErrorRequestHandler } from "express";
import { HttpError } from "../lib/errors.ts";
import { describeError, log } from "../lib/logger.ts";

// text or jsonb that Postgres cannot store, such as \u0000 or a lone surrogate
const UNSTORABLE = new Set(["22P02", "22P05", "22021"]);

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, code: error.code, details: error.details });
  } else if (error?.expose && error.status >= 400 && error.status < 500) {
    res.status(error.status).json({ error: error.message, code: "bad_request" });
  } else if (UNSTORABLE.has(error?.code)) {
    res.status(400).json({ error: "The request contains characters that cannot be stored", code: "invalid_input" });
  } else {
    log.error("request failed", { method: req.method, path: req.path, error: describeError(error) });
    res.status(500).json({ error: "Internal server error", code: "internal" });
  }
};
