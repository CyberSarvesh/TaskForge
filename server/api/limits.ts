import type { Request, RequestHandler } from "express";
import { config } from "../config.ts";
import { HttpError } from "../lib/errors.ts";
import { RateLimiter, addressKey } from "../lib/rateLimit.ts";

/**
 * Behind a proxy every socket belongs to the proxy. CLIENT_IP_HEADER must name a header that the
 * proxy overwrites. X-Forwarded-For does not qualify, because clients can prepend to it.
 */
export const clientKey = (req: Request) => {
  const forwarded = config.CLIENT_IP_HEADER ? req.get(config.CLIENT_IP_HEADER) : undefined;
  return addressKey(forwarded ?? req.socket.remoteAddress ?? "");
};

export const limitRequests = (): RequestHandler => {
  const reads = new RateLimiter(120, 3);
  const writes = new RateLimiter(15, 1 / 3);
  // A backstop for floods from many addresses. One address cannot drain it alone.
  const allWrites = new RateLimiter(40, 1);

  return (req, res, next) => {
    const client = clientKey(req);
    const allowed = ["GET", "HEAD", "OPTIONS"].includes(req.method)
      ? reads.take(client)
      : writes.take(client) && allWrites.take("all");
    if (allowed) return next();
    res.set("Retry-After", "3");
    next(new HttpError(429, "rate_limited", "Too many requests. Wait a few seconds and try again."));
  };
};
