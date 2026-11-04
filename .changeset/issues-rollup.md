---
'@nekolog-io/adapters': minor
'@nekolog-io/clickhouse': minor
'@nekolog-io/db': minor
---

Add the pieces an issue is made of. `@nekolog-io/adapters` gains the `IssueStore` contract with a memory implementation and `sqlIssueStore`, which takes an injected query runner rather than a driver, the way the Redis adapters take a client — so the package still has no runtime dependency. `@nekolog-io/clickhouse/issues` groups error rows by project, environment and fingerprint. `@nekolog-io/db` gains `issues` and `issue_environments`, because specification 5 says an issue is a project plus a fingerprint, counted per environment.

Three rules live in the store rather than in whatever calls it. First seen never moves forward and last seen never moves backward, however out of order the occurrences arrive. An issue that was **resolved** and then happens again is reopened and stamped `regressed_at` — but only when the occurrence is newer than the fix, so a late batch from before the fix does not undo it. An issue somebody chose to **ignore** is never reopened, which is what ignoring means.

The rollup windows by `received_at`, never by the `timestamp` the client chose, for the same reason `usage_per_minute` does: a sender that backdates its events would otherwise fall outside every window and never be grouped. The fingerprint travels as text the whole way — a `UInt64` does not fit in a JavaScript number, and `18446744073709551615` has to survive ClickHouse, the store and the Postgres column unchanged.
