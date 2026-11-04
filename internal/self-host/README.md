# @internal/self-host

The two adapters the self-host stack needs and the hosted stack does not.

On Cloudflare the spool is an R2 bucket and the quota block list is a Workers KV
document. Neither exists on a machine somebody rented, and neither should be
replaced by Postgres: **the ingestion never depends on Postgres or Redis**
(`docs/PLANO.md` §3), and the ingestion is exactly what writes the spool and
reads the block list. What is left is the filesystem — which is the honest
answer anyway, because self-host is one box and both of these are a handoff
between two containers on it, not durable object storage.

- `fileBlobStore(root)` — a `BlobStore` over a directory. `apps/ingest` writes a
  refused batch into it and `apps/jobs` replays it a minute later, through the
  same `spool-resend` task that runs on Cloudflare.
- `fileKvNamespace(folder)` — a `KvNamespace` over a directory, one file per
  key. `apps/jobs` writes `quota:blocks` and `apps/ingest` reads it.

Both are mounted into both containers as one Docker volume.

## Why the writes go through a rename

A reader of the spool is a different process from its writer, and it polls. A
`writeFile` straight onto the final name is visible while it is still partial,
so `spool-resend` can read half an envelope, fail to parse it and quarantine a
batch that was never broken. Both stores write a `.writing-<random>` file in the
destination directory and `rename` it into place, which is atomic on every
filesystem either container will see. A leftover temporary file is invisible:
`list` skips every name starting with a dot, and no key may begin with one.

## Why a key is an allowlist and not an escape

Half of a spool key is a `batchId` the client chose. `@internal/spool` already
refuses an unsafe one, but a store that turns keys into paths is the place where
a missed check becomes a file written outside its directory, so
`blobKeySegments` accepts only `[A-Za-z0-9][A-Za-z0-9._-]*` per segment: no
`..`, no empty segment, no leading dot, no backslash, no absolute path, no
drive letter, nothing a Windows filesystem refuses either. `kvFileName`
percent-encodes instead of refusing, because a KV key legitimately carries `:`,
and the encoding is injective so two keys can never land on one file.

## What is not here

No S3. The export of step 4.12 is written by ClickHouse itself into an S3
bucket, and reading those objects back needs credentials this package has no
business holding. Self-host therefore runs without exports until that gap is
closed; `deploy/self-host/README.md` says so in the open.
