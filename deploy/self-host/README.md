# The stack

Seven containers that run everything in this repository on one machine. This is
the composition the hosted service runs, not a demonstration of it.

```bash
cd deploy/self-host
./up.sh
```

**On Windows `up.sh` does not run** — it is `sh` and needs `openssl`. Copy
`.env.example` to `.env`, fill in the passwords yourself, and run
`docker compose up -d --build`.

## One way in

Only `proxy` is reachable from outside the machine. It is Caddy, it answers on
80 and 443, it gets a certificate for `ingest.$NEKOLOG_DOMAIN` and
`api.$NEKOLOG_DOMAIN` from Let's Encrypt, and it forwards to the two
applications over the private network.

`ingest`, `api` and the jobs health endpoint bind to **127.0.0.1** only, so they
are reachable for a local `curl` and for a monitor, and by nobody else. The two
databases publish no port at all. `compose.test.ts` fails if an application
starts listening on anything but the loopback, or if a second service starts
publishing to the world.

With `NEKOLOG_DOMAIN=localhost`, Caddy issues its own certificate and
`https://ingest.localhost` works for testing, which is how the whole path above
was verified.

## Sized for the smallest machine worth using

Every container has a `mem_limit`, and the defaults add up to about 3 GB so they
fit a 4 GB box with room for the operating system. ClickHouse takes the bulk of
it.

**ClickHouse's own ceiling is deliberately lower than its container limit.**
`max_server_memory_usage` is 1.2 GiB against a 1800 MB container, so a query
that asks for too much is refused by ClickHouse — with an error naming the
query — instead of the kernel killing the server and taking every other query
with it. `compose.test.ts` compares the two numbers and fails if the ceiling
ever rises above the limit.

Two settings cost time to get right, so they are worth knowing:

- `mark_cache_size` defaults to **5 GiB** and `uncompressed_cache_size` to
  **8 GiB**. Neither is allocated up front, but both count against the server
  ceiling as they fill, and on a small machine they are the difference between
  working and thrashing. They are 256 MiB and 128 MiB here.
- **Do not shrink `background_pool_size`.** It looks like a memory knob and is
  a thread-pool size, and ClickHouse refuses to start when
  `background_pool_size * background_merges_mutations_concurrency_ratio` falls
  below `number_of_free_entries_in_pool_to_execute_mutation` — "mutations
  cannot work with these settings". That is the server being right; it was
  tried here and it cost a restart loop to diagnose, because the error goes to
  `clickhouse-server.err.log` inside the container and never to stdout.

## What is deliberately not here

- **The dashboard**, because it is closed-source and cloud-only (`docs/PLANO.md`
  §1, §5). Self-host covers only what is in the public repository.
- **Exports.** 4.12 writes a CSV through ClickHouse into an S3 bucket; reading
  one back needs credentials this stack does not ask for and an `s3BlobStore`
  that does not exist. The export tasks are therefore **not wired** into the
  jobs container — `apps/jobs/src/self-host.test.ts` asserts that, so it is a
  decision rather than an oversight. The jobs ClickHouse user has no grant on S3
  at all, and `grants.test.ts` pins that too.
- **Redis.** Nothing here needs it: it exists for the dashboard's sessions.
- **An object store.** The spool is a directory shared between two containers.

## Why the spool and the block list are files

`apps/ingest` writes a batch ClickHouse refused into the spool, and `apps/jobs`
replays it a minute later. `apps/jobs` writes the quota block list and
`apps/ingest` reads it. On Cloudflare those are R2 and Workers KV. Here they are
two Docker volumes, through `@internal/self-host`'s `fileBlobStore` and
`fileKvNamespace` — **not** Postgres, because the ingestion never depends on
Postgres or Redis and the ingestion is what writes one and reads the other.

The mounts are not symmetric and that is on purpose: `ingest` mounts the KV
read-only and the state read-only; only `jobs` writes the KV, and only
`bootstrap` writes the state.

## Who may do what in ClickHouse

`clickhouse-users.xml` carries the same four credentials as dev, against one
database called `nekolog`. The jobs user may read `system.disks` — without it
`capacity-watch` reports "I cannot measure", which is an alert and not a
healthy disk. It has no `WRITE ON S3` and no `CREATE TEMPORARY TABLE`, because
nothing here exports.

The `api` container runs as `nekolog_reader`, which holds `SELECT` on the one
database and nothing else — no S3, no `system`, no write of any kind. It mounts
the state volume read-only and neither the spool nor the KV, because it has no
business with either. `compose.test.ts` fails if any of that changes.

## The read API

`api` serves `/v1/logs`, `/v1/histogram` and `/v1/issues` against a `sk_` key
carrying `logs:read`, and publishes its own contract at `/openapi.json`. This is
the self-host's whole reading surface, since the dashboard is not here: point a
script, a Grafana datasource or `curl` at it.

It needs Postgres as well as ClickHouse — `issues` lives in Postgres — which is
also why `DATABASE_URL` is required rather than optional. Starting without it
would mean an API that answers `404` on a third of its routes and says nothing
about why.

## The bootstrap container

It runs to completion before `ingest` and `jobs` start, and it is safe to run
again:

1. `pnpm ch:migrate` — the ClickHouse migrations.
2. `pnpm db:migrate` — the Postgres migrations.
3. `pnpm seed init` the first time, writing the keys to a `0600` file on the
   state volume rather than to the container log.
4. `pnpm seed sync-db` — the organization, project, environments and **key
   hashes** into Postgres.

Step 4 is not decoration. The seed document is what the ingestion reads for
keys, but `issues`, `alert_rules` and `alert_channels` all carry a foreign key
to `projects` and `environments`; without those rows the issue rollup fails the
moment a real error arrives. On the hosted service the dashboard writes them.
Here nothing else would.

## Secrets

`.env` is generated by `up.sh` and is gitignored. `ENCRYPTION_KEY` is the one
value that cannot be recovered from any backup of either database: it seals
every alert channel secret. Back it up separately, and rotate it only through
`resealChannelSecrets` (`docs/runbooks/rotacao-de-segredos.md`).

The compose refuses to start when a password is missing (`${VAR:?…}`) rather
than falling back to a default. That is the same rule as everywhere else here:
a control that quietly does nothing is worse than one that fails loudly.

## The image

One image, three commands. It is the whole workspace with `pnpm install` run
once; nothing is built, because Node 24 runs the TypeScript directly, which is
also how `pnpm seed` and `pnpm ch:migrate` work outside Docker.

Two details that cost time to find:

- The root `prepare` script runs `lefthook install`, which needs a git
  repository. `.git` is not in the build context, so the Dockerfile deletes that
  one script before installing. Shipping `.git` to make a hook installer happy
  would be worse.
- `COREPACK_HOME` is set and `corepack install` runs during the build, so the
  containers do not download pnpm from the network every time they start. The
  two long-running services do not use pnpm at all: they run `node` directly.
