---
'@internal/adapters': minor
'@internal/clickhouse': minor
'@apps/ingest': minor
'@apps/jobs': minor
---

Add the per-environment rate limit, the per-project attribute budget and the daily quota block.

Usage is now counted from a new `usage_per_minute` rollup grouped by `received_at` instead of
`logs_per_minute`, which groups by the client-supplied `timestamp` — a quota built on the latter
could be dodged by backdating events. The ingestion Worker's ClickHouse user needs
`SELECT(received_at)` on `logs` before the migration applies.
