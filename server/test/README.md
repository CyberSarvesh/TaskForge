# Tests

| File | Needs databases | What it proves |
| --- | --- | --- |
| `policy.test.ts` | no | Backoff, jitter, priority ordering and aging |
| `limits.test.ts` | no | Rate-limit buckets, address keys and shared results |
| `validation.test.ts` | no | Input validation, and that every form and scenario produces valid jobs |
| `migration.integration.test.ts` | yes | A hand-made v1 `jobs` table upgrades without losing rows |
| `store.integration.test.ts` | yes | One claim wins, and stale workers are fenced out |
| `system.integration.test.ts` | yes | A real API and real worker processes through crashes, outages and races |
| `publicDemo.integration.test.ts` | yes | What anonymous visitors can and cannot do with `PUBLIC_DEMO` |

The integration tests expect `npm run infra` from the repository root. To use other servers set `TEST_PG*`
and `TEST_REDIS_*`. The usual `PG*` variables are ignored, because each test creates and drops its own
database and must never land on your server by accident.

Set `TEST_LOGS=1` to print the logs of the spawned processes.
