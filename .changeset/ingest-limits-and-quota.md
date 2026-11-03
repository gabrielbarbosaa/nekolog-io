---
'@nekolog-io/adapters': minor
'@nekolog-io/clickhouse': minor
---

Add the `RateLimiter` and `QuotaStore` adapters behind the per-environment rate limit and the daily quota block, and the `usage_per_minute` rollup they read.

Usage is counted from `usage_per_minute`, grouped by `received_at`, instead of `logs_per_minute`, which groups by the client-supplied `timestamp` — a quota built on the latter could be dodged by backdating events. The ingestion Worker's ClickHouse user needs `SELECT(received_at)` on `logs` before the migration applies.
