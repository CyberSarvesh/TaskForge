import { isIP } from "node:net";

/** A token bucket per key: short bursts are fine, sustained floods are not. */
export class RateLimiter {
  #buckets = new Map<string, { tokens: number; at: number }>();
  #capacity: number;
  #perSecond: number;
  #maxKeys: number;

  constructor(capacity: number, perSecond: number, maxKeys = 10_000) {
    this.#capacity = capacity;
    this.#perSecond = perSecond;
    this.#maxKeys = maxKeys;
  }

  take(key: string, now = Date.now()) {
    const previous = this.#buckets.get(key);
    const tokens = previous
      ? Math.min(this.#capacity, previous.tokens + (Math.max(0, now - previous.at) / 1000) * this.#perSecond)
      : this.#capacity;

    // Re-inserting keeps the map ordered by last use, so the first key is the one to forget.
    this.#buckets.delete(key);
    if (this.#buckets.size >= this.#maxKeys) this.#buckets.delete(this.#buckets.keys().next().value!);

    const allowed = tokens >= 1;
    this.#buckets.set(key, { tokens: allowed ? tokens - 1 : tokens, at: now });
    return allowed;
  }
}

/** IPv6 users are handed a whole /64, so that is the unit to limit. IPv4 is used as is. */
export const addressKey = (address: string) => {
  const ip = address.trim().toLowerCase().replace(/^::ffff:(?=\d+\.)/, "");
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) !== 6) return "unknown";

  const [head = "", tail] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  // A trailing dotted IPv4 part stands for two groups.
  const width = right.length + (right.at(-1)?.includes(".") ? 1 : 0);
  const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - width)).fill("0"), ...right];
  return `${groups.slice(0, 4).map((group) => Number.parseInt(group, 16).toString(16)).join(":")}::/64`;
};
