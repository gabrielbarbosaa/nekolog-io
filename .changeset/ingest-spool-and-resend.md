---
"@apps/ingest": minor
"@apps/jobs": minor
---

Keep a batch ClickHouse refused, and replay it exactly once.

The ingest Worker writes the already-mapped rows to the R2 `SPOOL` bucket when
the insert fails, and still answers 202. `onError` now fires only when both
ClickHouse and R2 failed, and the message carries both causes. The `SPOOL`
binding is required: a deployment without it would quietly drop the durability
promise (threat D6).

`apps/jobs` registers its first task, `spool-resend`, every minute. It takes the
oldest files first, inserts, and only then deletes — a failed delete just means
the next tick resends, and the deduplication token makes that a no-op. It stops
at the first error that could pass later, because if ClickHouse is down the
other files will fail the same way, and it does not stop at an error that never
will: a 400 means those bytes are permanently unacceptable, so that file goes to
`quarantine/` instead of blocking the queue forever. Unreadable files, keys that
are not spool keys, and batches older than the retention window are quarantined
too.

The deduplication token is now `<environmentId>:<batchId>` rather than the bare
`batchId`. The id is chosen by the client and ClickHouse deduplicates per table
partition, which every project shares, so an unscoped token let one tenant's
batch suppress another's.

New `@internal/spool` holds the format both sides use: a zero-padded timestamp
key so listing the first N objects returns the oldest N, strict decoding, and
batch-id validation on the way into a file name. New `BlobStore` implementations
in `@internal/adapters` (memory and R2), and `BlobStore.list` now takes a limit
so the sweep does not walk the whole bucket every minute.

A task's returned object now reaches the run summary as `detail`, so the sweep
can report what it did.
