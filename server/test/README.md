# Tests

| File | Needs databases | What it proves |
| --- | --- | --- |
| `policy.test.ts` | no | Backoff, jitter, priority ordering and aging |
| `validation.test.ts` | no | Input validation, and that every form and scenario produces valid jobs |
| `migration.integration.test.ts` | yes | A hand-made v1 `jobs` table upgrades without losing rows |
| `store.integration.test.ts` | yes | One claim wins, and stale workers are fenced out |
| `system.integration.test.ts` | yes | A real API and real worker processes through crashes, outages and races |

The integration tests expect `npm run infra` from the repository root, or the usual `PG*` and `REDIS_*`
environment variables. Each test creates and drops its own database and uses its own Redis key, so they
don't touch your data.

Set `TEST_LOGS=1` to print the logs of the spawned processes.
