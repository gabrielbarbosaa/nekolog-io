---
"@apps/ingest": minor
---

Write accepted batches to ClickHouse, behind `waitUntil`.

The 202 goes out as soon as the batch validates; the insert runs in the
platform's `waitUntil`, which the app finds through the Hono context rather
than being told about. Outside a Worker there is none, so the write is awaited
instead. A failed write does not change the 202 — the batch was accepted, and
the failure goes to `onError` and, from step 1.11, to the R2 spool.

The server stamps `project_id`, `environment_id`, `received_at`, `country` and
`retention_days`. No IP header is read anywhere on the path, only the country,
validated as two characters. `fingerprint` stays 0 until step 4.5.

An `error.message` that differs from the log message is kept as an attribute
rather than dropped, since the table has no column for it.

The columns a row writes are checked against the migration itself, so renaming
a column without updating the mapping fails a test.

`src/worker.ts` is the Cloudflare entry. `assertEnv` names every missing
binding at once instead of letting the first request die on `undefined`.
