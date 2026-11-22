export const failureCases = [
  {
    question: "a worker dies mid-job?",
    answer: "Its lease runs out and another worker takes over.",
    detail: [
      "A claim is a lease with an expiry, renewed on every heartbeat. A killed process stops renewing.",
      "Every worker runs the recovery sweep. SKIP LOCKED lets them all run it at once, so there is no leader to elect or lose.",
    ],
    code: `SELECT id FROM jobs
WHERE status = 'processing'
  AND (lease_until IS NULL OR lease_until < now())
LIMIT 500 FOR UPDATE SKIP LOCKED`,
    source: "server/services/jobStore.ts, recoverExpiredLeases",
  },
  {
    question: "a frozen worker wakes up?",
    answer: "Its late result is rejected.",
    detail: [
      "A long pause looks exactly like death, so the job may already belong to someone else. Each claim gets a new random token and every write must present it.",
      "The old token matches zero rows, so a stale worker cannot overwrite the new owner.",
    ],
    code: `UPDATE jobs SET status = 'completed', ...
WHERE id = $1
  AND lease_token = $2
  AND status = 'processing'`,
    source: "server/services/jobStore.ts, completeJob",
  },
  {
    question: "Redis goes down or loses its data?",
    answer: "Nothing is lost. Dispatch waits.",
    detail: [
      "A job is committed to Postgres before Redis hears of it, and the API still answers while Redis is away.",
      "The sweep re-adds due jobs that are undispatched or stale. The queue is a sorted set, so adding an id twice is a no-op.",
    ],
    code: `await redis.zadd(QUEUE_KEY, "NX", ...members);`,
    source: "server/services/queueService.ts, enqueue",
  },
  {
    question: "two workers get the same id?",
    answer: "Exactly one claim succeeds.",
    detail: [
      "A queue message is only a hint. Ownership is decided by a conditional update, and Postgres serialises updates to a row.",
      "The loser updates zero rows and moves on.",
    ],
    code: `UPDATE jobs SET status = 'processing', lease_token = $3, ...
WHERE id = $1
  AND status = 'pending'
  AND run_at <= now()`,
    source: "server/services/jobStore.ts, claimJob",
  },
  {
    question: "a dependency keeps failing?",
    answer: "Retries back off, spread out, then stop.",
    detail: [
      "The delay doubles up to 30 seconds. Jitter stops a thousand failed jobs from returning in the same instant.",
      "When attempts run out the job rests as failed until someone runs it again. A PermanentError skips the retries.",
    ],
    code: `const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1));
return Math.round(delay / 2 + random() * (delay / 2));`,
    source: "server/lib/policy.ts, retryDelay",
  },
  {
    question: "urgent work never stops arriving?",
    answer: "Low priority still gets its turn.",
    detail: [
      "Priority is a head start measured in time and not a separate queue. High gets a minute's advantage, low a minute's handicap.",
      "A low job that has waited over two minutes beats a brand new high one, so starvation is impossible.",
    ],
    code: `const PRIORITY_OFFSET_MS = { high: -60_000, normal: 0, low: 60_000 };
score = runAt.getTime() + PRIORITY_OFFSET_MS[priority];`,
    source: "server/lib/policy.ts, queueScore",
  },
  {
    question: "a client sends a request twice?",
    answer: "It gets the original job back.",
    detail: [
      "An Idempotency-Key is backed by a unique index, so concurrent duplicates are settled by the database and not by a check that can race.",
      "Reusing a key for a different job is refused with 422.",
    ],
    code: `ON CONFLICT (idempotency_key)
  WHERE idempotency_key IS NOT NULL
DO NOTHING`,
    source: "server/services/jobStore.ts, insertJobs",
  },
  {
    question: "this screen misses an update?",
    answer: "It resyncs from the database.",
    detail: [
      "Each state change writes its event in the same SQL statement. A trigger notifies on commit and the API relays that over Server-Sent Events.",
      "Events only make the screen quick. Snapshots correct it after any gap or reconnect.",
    ],
    code: `CREATE CONSTRAINT TRIGGER job_events_notify
  AFTER INSERT ON job_events
  DEFERRABLE INITIALLY DEFERRED ...`,
    source: "server/db/migrations/001_jobs.sql",
  },
];

export const tradeoffs: [string, string][] = [
  [
    "At-least-once, not exactly-once",
    "A worker can die after a side effect and before recording it, so handlers need to be idempotent.",
  ],
  [
    "Postgres on every transition",
    "Durability and an audit trail cost throughput. For very high volume, batch claims and completions.",
  ],
  [
    "NOTIFY for live updates",
    "No extra broker is needed, but notifying commits are serialised, which eventually becomes a ceiling.",
  ],
  [
    "Recovery waits for the lease",
    "A short lease recovers faster but mistakes slow workers for dead ones. The default is 10 seconds.",
  ],
  [
    "No authentication",
    "It binds to localhost and checks Host and Origin. Put it behind an authenticating proxy before exposing it.",
  ],
  [
    "Events are kept forever",
    "That suits a demo and an audit trail. A busy deployment needs partitioning or a retention job.",
  ],
];
