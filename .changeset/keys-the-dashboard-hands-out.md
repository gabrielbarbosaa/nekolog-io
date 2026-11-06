---
'@nekolog-io/adapters': minor
'@nekolog-io/clickhouse': minor
'@apps/dashboard': minor
'@apps/ingest': minor
'@apps/jobs': minor
'@internal/auth': minor
'@internal/seed': patch
---

API keys the dashboard mints, shows once and can revoke or rotate. The dashboard
writes to Postgres only; the new `key-sync` task publishes every live key, with
the settings of its environment, to the KV once a minute, and the ingestion reads
the KV behind a cache. `logs.key_id` records which key wrote a row, so a rotation
can be told whether the old key is still in use, and `key-usage` stamps that back
onto `api_keys.last_used_at`.

Two fixes ride along: a record read back out of the KV was silently losing its
minimum level, sample rate and redaction rules, and the key cache was holding a
miss for a full minute, which would have made a freshly minted key fail for
longer than it took to create.
