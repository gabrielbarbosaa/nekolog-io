# The stack

Eight containers that run everything in this repository on one machine. This is
the composition the hosted service runs, not a demonstration of it.

**Nothing is backed up until you say where to.** See
[the backup](#the-backup-which-is-off-by-default-and-says-so).

```bash
cd deploy/self-host
./up.sh
```

**On Windows `up.sh` does not run** — it is `sh` and needs `openssl`. Copy
`.env.example` to `.env`, fill in the passwords yourself, and run
`docker compose up -d --build`.

## How a new version gets here

The machine holds a clone and builds the image itself. There is no registry
([ADR 0018](../../docs/adr/0018-deploy-por-git-pull-na-maquina.md) says why, and
what it would take to change).

```bash
deploy/self-host/deploy.sh
```

It refuses to run outside a clone, on a branch other than `main`
(`NEKOLOG_DEPLOY_BRANCH` to change that), or with anything uncommitted — a
deploy has to be reproducible from a commit. It fast-forwards, never merges,
prints the commits it is about to apply, builds, and waits for every container
to come up before it says it worked. **It prints the rollback command before and
after**, because rolling back is by hand:

```
deploy: roll back with: git -C /srv/nekolog checkout 408e8c6 && …/deploy.sh
```

`docker compose up -d --build` only replaces containers once the build has
succeeded, so a build that fails leaves what is running untouched. A build that
succeeds with bad code does not — that is what the rollback line is for.

## The image is 1 GB, and it was 2

Building on a 1 vCPU box next to a running ClickHouse only works because the
image installs the **production graph of four entry points** rather than the
whole monorepo: `node_modules` went from 1.3 GB to 12.6 MB, and the image from
2.09 GB to 1.05 GB. `@nekolog-io/db`'s dev dependencies come back in a second
install because `bootstrap` migrates Postgres with drizzle-kit, and the pnpm
store is deleted afterwards — it is a second copy of everything already linked
into `node_modules`.

`.github/workflows/self-host.yml` builds this image on every PR that touches it
and starts all four entry points, checking each refuses for the right reason. A
broken dependency install is invisible to every other check in CI.

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

## The backup, which is off by default and says so

Fill `BACKUP_S3_ENDPOINT`, `BACKUP_S3_ACCESS_KEY_ID` and
`BACKUP_S3_SECRET_ACCESS_KEY` in and the jobs container backs the whole
`nekolog` database up once a day, straight from ClickHouse into that bucket.
Leave them empty and there is no backup at all — and the container says exactly
that on every start, because a platform that quietly keeps one copy of somebody
else's data is worse than one that refuses to start.

**It has to be a bucket somewhere else.** A backup on this disk dies with this
disk, and this machine has one. Any S3-compatible store works.

Three things follow from how ClickHouse does this, and all three are deliberate:

- **The backup runs as `nekolog_backup`, a credential of its own**, holding only
  `BACKUP ON nekolog.*`, `WRITE ON S3` and `SELECT ON system.backups`. It writes
  a complete copy of every log and **cannot read a single one** — that was
  measured, not assumed. Nothing else here may reach an object store.
- **Nothing deletes an old backup**, because ClickHouse cannot delete an S3
  object. Put a lifecycle rule on the bucket or it grows forever.
- **Each backup is full and independent.** No incremental chain, so losing one
  does not take the others with it. That costs space and buys the property that
  matters.

Half-configuring it is refused at startup, naming what is missing. Restoring is
in [the runbook](../../docs/runbooks/restauracao-de-backup.md#35-restaurar-o-clickhouse);
the short version is that you restore into a **new** database and compare counts
before trusting it.

### The Postgres goes to the same bucket, by a different route

`BACKUP_AGE_RECIPIENT` turns on the `backup` container, which runs
`pg_dump | gzip | age | rclone rcat` as **one pipe** — no readable `.sql` ever
exists, not even for a moment, not even inside the container. It checks the
bucket on each wake rather than remembering anything, so a restart does not
produce a second dump, and **it deletes nothing on a day it failed to write
one**.

It is a container of its own and that is the point: a `pg_dump` can take
minutes, and a task inside the jobs scheduler would hold every other task —
alerts, spool, quota — for its whole duration.

`BACKUP_AGE_RECIPIENT` is the **public** half of an age key pair. Keep the
private half off this machine. That is what makes the difference on the day
somebody gets in: they reach the bucket, and the backups stay unreadable.

```bash
docker compose run --rm backup age-keygen -o identity.key   # keep this offline
docker compose run --rm backup age-keygen -y identity.key   # paste this in .env
```

Note the asymmetry, which is deliberate and written down as **I15** in the
threat model: the Postgres dump is encrypted with a key that is not on this
machine, while the ClickHouse backup is written by ClickHouse itself and is only
as private as the bucket.

`.github/workflows/backup.yml` no longer dumps anything. It kept the **restore
test**, by hand, because restoring on a different machine than the one that made
the backup is the only version of that test worth running.

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

`clickhouse-users.xml` carries the same five credentials as dev, against one
database called `nekolog`. The jobs user may read `system.disks` — without it
`capacity-watch` reports "I cannot measure", which is an alert and not a
healthy disk. It has no `WRITE ON S3` and no `CREATE TEMPORARY TABLE`, because
nothing here exports: the only credential that may reach an object store is
`nekolog_backup`, and that one may not read a row.

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
