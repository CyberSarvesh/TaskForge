import type { RequestHandler } from "express";
import { config } from "../config.ts";
import { HttpError } from "../lib/errors.ts";

const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.set({
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  next();
};

/** A DNS-rebinding page reaches 127.0.0.1 but still sends its own name in Host. */
export const checkHost: RequestHandler = (req, _res, next) => {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
  if (config.ALLOWED_HOSTS.includes("*") || config.ALLOWED_HOSTS.includes(host)) return next();
  next(new HttpError(403, "host_not_allowed", "Host not allowed; see ALLOWED_HOSTS"));
};

/** There are no sessions, but any website can still POST to localhost. Browsers always send Origin. */
export const checkOrigin: RequestHandler = (req, _res, next) => {
  const origin = req.headers.origin;
  if (!origin || ["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (config.CORS_ORIGINS.includes(origin)) return next();
  if (URL.canParse(origin) && new URL(origin).host === req.headers.host) return next();
  next(new HttpError(403, "origin_not_allowed", "Origin not allowed; see CORS_ORIGINS"));
};
