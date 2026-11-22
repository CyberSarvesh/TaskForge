import assert from "node:assert/strict";
import { test } from "node:test";
import { queueScore, retryDelay } from "../lib/policy.ts";

const NOW = 1_800_000_000_000;

test("backoff doubles, then caps at 30 seconds", () => {
  const ceiling = [1, 2, 3, 4, 5, 6, 50].map((attempt) => retryDelay(attempt, () => 1));
  assert.deepEqual(ceiling, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
});

test("jitter never goes below half of the delay", () => {
  assert.equal(retryDelay(3, () => 0), 2000);
  for (let i = 0; i < 1000; i++) {
    const delay = retryDelay(3);
    assert.ok(delay >= 2000 && delay <= 4000);
  }
});

test("priority orders jobs that arrive together", () => {
  const at = new Date(NOW);
  assert.ok(queueScore("high", at) < queueScore("normal", at));
  assert.ok(queueScore("normal", at) < queueScore("low", at));
});

test("an old low-priority job beats a new high-priority one", () => {
  assert.ok(queueScore("low", new Date(NOW - 121_000)) < queueScore("high", new Date(NOW)));
});

test("equal priority is first in, first out", () => {
  assert.ok(queueScore("normal", new Date(NOW)) < queueScore("normal", new Date(NOW + 1)));
});
