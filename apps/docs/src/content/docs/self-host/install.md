---
title: Run NekoLog yourself
description: One command brings up ingestion, jobs, ClickHouse and Postgres on your own machine.
---

:::caution[The dashboard is not part of this]
NekoLog is open-core. The SDKs, the ingestion, the background jobs and this
documentation are MIT and live in the public repository; **the dashboard is
closed-source and runs only on the hosted service**. Running it yourself gives
you ingestion, storage, issue grouping and alerts — not a screen to look at
them in. Read the section *What you do not get* before you start, not after.
:::

## What you need

A machine with Docker and the Compose plugin, 4 GB of RAM and a disk you are
willing to fill with logs. Nothing else: no Cloudflare account, no managed
Postgres, no object storage.

```bash
git clone https://github.com/gabrielbarbosaa/nekolog-io
cd nekolog-io/deploy/self-host
./up.sh
```

`up.sh` writes a `.env` with freshly generated secrets if there is none, builds
the image and brings the stack up. It is one command because the alternative —
a list of steps where one is skipped — is how a self-host ends with a blank
password in production.

The first run prints where your API keys were written. They are **not** in the
container log on purpose:

```bash
docker compose run --rm --entrypoint sh bootstrap -c 'cat /var/lib/nekolog/state/first-run-keys.txt'
docker compose run --rm --entrypoint sh bootstrap -c 'rm /var/lib/nekolog/state/first-run-keys.txt'
```

Copy them somewhere safe and delete the file. They are shown once.

## Send your first log

The ingestion answers on port 8787. Point any NekoLog SDK at it:

```bash
NEKOLOG_KEY=nekolog_sk_…
NEKOLOG_ENDPOINT=http://localhost:8787
```

```ts
import { createLogger } from '@nekolog-io/node'

const log = createLogger({ key: process.env.NEKOLOG_KEY, endpoint: process.env.NEKOLOG_ENDPOINT })
log.error('it broke', new Error('cannot read properties of undefined'))
```

:::danger[Put TLS in front of it]
The ingestion container speaks plain HTTP, and an API key travels in the
`Authorization` header. Exposing port 8787 to the internet publishes your keys
to anyone on the path. Put Caddy, nginx or any reverse proxy with a certificate
in front of it before you point a production service at it.
:::

## What is running

| Container | What it does |
|---|---|
| `ingest` | validates, redacts, fingerprints and writes every batch |
| `jobs` | wakes every minute: alerts, issue grouping, quotas, the spool, capacity |
| `clickhouse` | the logs |
| `postgres` | projects, environments, keys, issues, alert rules and channels |
| `bootstrap` | runs once: migrations, then the first project and its keys |

Neither database publishes a port. They are reachable only from inside the
compose network, which is what keeps a default password on a cloud machine from
being a disclosure.

## What you do not get

Three things are missing, and none of them is a bug you should work around:

- **The dashboard.** It is closed-source and cloud-only.
- **Exports.** Step 4.12 generates a CSV through ClickHouse into an S3 bucket.
  That needs object storage and credentials this stack does not ask you for, so
  the export tasks are not wired into the self-host jobs container at all —
  rather than wired and failing every minute.
- **Source-map resolution.** It needs a place to upload maps to, which is still
  being designed.

Everything else runs: ingestion, OTLP, redaction, sampling, minimum level,
quotas, issue grouping and alerts to a webhook.

## Keys, environments and retention

The first run mints one project with one environment called `production`, kept
for 30 days. Change that before the first run:

```bash
SEED_ENVIRONMENTS=production,staging SEED_RETENTION_DAYS=14 ./up.sh
```

Afterwards, mint another key without touching the ones already in use:

```bash
docker compose run --rm --entrypoint sh bootstrap -c \
  'pnpm seed add-key --environment production --file /var/lib/nekolog/state/.nekolog-seed.json'
```

A key is shown once and only its hash is stored, here as on the hosted service.
`seed init` refuses to overwrite an existing project: new identifiers would
orphan every row already in ClickHouse.

## Alerts

An alert rule lives in Postgres and the jobs container evaluates it every
minute. Without the dashboard you write the rows yourself, which is also how you
would script them:

```bash
docker compose exec postgres psql -U nekolog -d nekolog
```

The alert message carries the environment, the measured value, the threshold and
the window, plus a link built from `NEKOLOG_CONSOLE_URL`. Self-host ships no
screen, so point that variable at whatever you actually use to read logs — it
only ever becomes a link inside a message, nothing calls it.

Set `OPS_DISCORD_WEBHOOK_URL` to hear about the platform itself: a disk filling
up, a spool that will not drain, an environment blocked for going over quota.

## Backups

Two volumes hold data you cannot regenerate, and one holds a secret:

- `nekolog_clickhouse_data` — the logs.
- `nekolog_postgres_data` — projects, keys, issues, alert rules.
- `.env` — `ENCRYPTION_KEY` seals every alert channel secret. It is not in any
  database and it cannot be recovered from one. Back it up separately from the
  databases, and if you ever change it, re-encrypt before you restart.

## Upgrading

```bash
git pull
docker compose up -d --build
```

The bootstrap container runs again and applies any new migration before the
other two start. Migrations are forward-only: there is no down step, which is
why a backup before an upgrade is worth the minute it costs.

## When it will not start

The stack refuses to run half-configured rather than starting with something
guessable, so a failure names what is missing.

| What you see | What it means |
|---|---|
| `set CLICKHOUSE_… in .env` | compose has no `.env`; run `./up.sh` or copy `.env.example` |
| `is missing SPOOL_DIR, KV_DIR` | the container lost its volume mounts |
| `Nothing answered on ClickHouse` | ClickHouse is still starting; it waits for a healthcheck |
| `Not enough privileges` | `clickhouse-users.xml` was edited; restart the clickhouse container |

`docker compose logs jobs` prints one JSON line per minute naming every task
that ran and how long it took. That line is the fastest way to see whether the
platform is working.
