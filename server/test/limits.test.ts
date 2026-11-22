import assert from "node:assert/strict";
import { test } from "node:test";
import { RateLimiter, addressKey } from "../lib/rateLimit.ts";
import { shareFor } from "../lib/shareFor.ts";

test("a bucket allows a burst, refuses, then refills", () => {
  const limiter = new RateLimiter(3, 1);
  assert.deepEqual([1, 2, 3, 4].map(() => limiter.take("a", 1000)), [true, true, true, false]);
  assert.equal(limiter.take("b", 1000), true);
  assert.equal(limiter.take("a", 2000), true);
  assert.equal(limiter.take("a", 2000), false);
});

test("the bucket table stays bounded", () => {
  const limiter = new RateLimiter(1, 0.001, 2);
  for (const key of ["a", "b", "c"]) limiter.take(key, 1000);
  assert.equal(limiter.take("a", 1000), true, "the oldest key was forgotten");
});

test("IPv6 addresses in one /64 share a key", () => {
  const key = addressKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
  assert.equal(addressKey("2001:0db8:0001:0002::9"), key);
  assert.notEqual(addressKey("2001:db8:1:3::9"), key);
  assert.equal(addressKey("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(addressKey("::1"), "0:0:0:0::/64");
  assert.equal(addressKey("::ffff:192.0.2.4"), "192.0.2.4");
  assert.equal(addressKey("junk, 1.2.3.4"), "unknown");
});

test("simultaneous callers share one load, and failures are not cached", async () => {
  let calls = 0;
  const load = shareFor(10_000, async () => {
    calls++;
    if (calls === 1) throw new Error("first");
    return calls;
  });
  await assert.rejects(load());
  const results = await Promise.all([load(), load(), load()]);
  assert.deepEqual(results.map((result) => result.value), [2, 2, 2]);
});
