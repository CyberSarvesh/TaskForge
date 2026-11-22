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

const MAX_IN_FLIGHT = 12;
const MAX_IN_FLIGHT_PER_ADDRESS = 4;

/**
 * A rate limit still lets a burst arrive in the same instant. On a tiny CPU that fills the Postgres
 * pool, and then everyone's live view fails. Job lookups are the unshared, per-request queries, so
 * only a few of them may run at once.
 */
export const limitLookups = (): RequestHandler => {
  const perAddress = new Map<string, number>();
  let total = 0;

  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const client = clientKey(req);
    const mine = perAddress.get(client) ?? 0;
    if (total >= MAX_IN_FLIGHT || mine >= MAX_IN_FLIGHT_PER_ADDRESS) {
      res.set("Retry-After", "1");
      return next(new HttpError(429, "busy", "The demo is busy. Try again in a moment."));
    }
    total++;
    perAddress.set(client, mine + 1);
    res.on("close", () => {
      total--;
      const left = perAddress.get(client)! - 1;
      if (left) perAddress.set(client, left);
      else perAddress.delete(client);
    });
    next();
  };
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
