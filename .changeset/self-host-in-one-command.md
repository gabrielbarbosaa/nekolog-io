---
'@apps/ingest': minor
'@apps/jobs': minor
---

Run the whole platform on one machine with one command.

`deploy/self-host/` brings up ClickHouse, Postgres, the ingestion and the jobs
behind a bootstrap container that applies every migration and mints the first
project before anything else starts. `./up.sh` generates the secrets if there
are none, because the alternative — a list of steps where one is skipped — is
how a self-host ends with a blank password in production. The installation
guide is in `apps/docs` in all three languages, and it says on its first screen
that **the dashboard is not included**: it is closed-source and cloud-only.

**The spool and the quota block list are files, not Postgres.** On Cloudflare
they are R2 and Workers KV. Here `@internal/self-host`'s `fileBlobStore` and
`fileKvNamespace` put them in two Docker volumes shared by the two containers —
Postgres would have been the obvious choice and it is the wrong one, because
the ingestion never depends on Postgres or Redis and the ingestion is exactly
what writes one and reads the other. Both write through a `rename`, so a reader
polling the spool cannot pick up half an envelope and quarantine a batch that
was never broken, and a blob key is an allowlist of `[A-Za-z0-9][A-Za-z0-9._-]*`
per segment, because half of a spool key is a `batchId` the client chose.

**The self-host jobs container runs more than the Worker does.** A Worker
cannot reach Postgres, so `alert-evaluate`, `alert-notify` and `issue-rollup`
are wired here and not there. `DATABASE_URL`, `ENCRYPTION_KEY` and
`NEKOLOG_CONSOLE_URL` are therefore required rather than optional: a jobs
container that starts without them would silently not evaluate a single alert.

**`pnpm seed sync-db` is new and it is not decoration.** The seed document is
what the ingestion reads for keys, but `issues`, `alert_rules` and
`alert_channels` all carry a foreign key to `projects` and `environments`. On
the hosted service the dashboard writes those rows; here nothing would, and the
first real error made the issue rollup fail with a foreign key violation —
found by running the stack, not by reading it. The command writes the
organization, the project, the environments and the **key hashes**, never a key.

**The jobs ClickHouse user could not read `system.disks` anywhere**, so
`capacity-watch` has been reporting "I cannot measure" — which is an alert, and
correctly so — instead of watching the disk. The grant is added in all three
users files and `grants.test.ts` now pins it, along with the fact that it is
the only part of `system` any credential may read.

Exports are deliberately **not** wired into the self-host jobs container: 4.12
writes a CSV through ClickHouse into an S3 bucket, and reading one back needs
credentials this stack does not ask for. Not wired beats wired and failing
every minute, and both the guide and a test say so out loud.
