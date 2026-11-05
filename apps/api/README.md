# `@apps/api` — the public read API

The read side of NekoLog, for people and programs that are not the dashboard: search
the logs, read their histogram, list the issues. It is the same Hono app on Cloudflare
Workers (`src/worker.ts`) and on Node (`src/serve.ts`, `src/serve-self-host.ts`), which
is what makes it part of the self-host rather than a hosted-only feature.

It serves its own contract at `GET /openapi.json`, built against whatever address the
request arrived on.

## What it answers

| Route | What it does |
| --- | --- |
| `GET /health` | Whether this deployment came up with everything it needs. No key. |
| `GET /openapi.json` | The OpenAPI 3.1 document for the routes below. No key. |
| `GET /v1/logs` | Search, with `q`, `from`, `to`, `limit`, `order`. |
| `GET /v1/histogram` | Counts per bucket and level, with `q`, `from`, `to`, `bucket`. |
| `GET /v1/issues` | Errors grouped by fingerprint, with `status`, `since`, `until`, `limit`, `cursor`. |
| `POST /v1/releases` | Record that a version went out. |
| `POST /v1/sourcemaps` | Upload one `.map` against a release that already exists. |

```
curl -H "Authorization: Bearer nekolog_sk_…" \
  "https://api.nekolog.io/v1/logs?q=level:error%20service:checkout&from=2026-11-04T00:00:00Z"
```

## Five rules it will not bend

**The scope comes from the key, never from the request.** A `sk_` key belongs to one
project and one environment, and `searchWhere` injects both into every statement. A
caller who passes `?project=` or `?environment=` changes nothing, and `env:` inside the
search is **refused** rather than ignored — the environment is not theirs to choose, and
a silent no-op would read like a filter that works.

**A key travels in `Authorization: Bearer`, and a request carrying `?key=` is refused
before anything else is read** — even a blank one, even when a valid header is also
present. The ingestion has a `?key=` path because `navigator.sendBeacon` cannot send a
header during a page unload; nothing here is a beacon, so there is no such excuse. A URL
ends up in access logs, proxies and browser history.

**A public key is refused.** It is published to every browser that loads the page, so a
key that may read a tenant's logs cannot be one. The seed mints `logs:write` only for a
public key, and this API demands `logs:read`.

**The two routes that write ask for a different scope.** `POST /v1/releases` and
`POST /v1/sourcemaps` need `logs:write`; every other route needs `logs:read` and is a
`GET`. A `POST` to `/v1/logs` is a 404, not a method error, and a `GET` on
`/v1/releases` is a 404 too. The ClickHouse credential is `nekolog_reader`, which holds
`SELECT` on one database and no grant on S3 or on `system` — nothing this app writes
goes to ClickHouse. Its only R2 binding is `SOURCEMAPS`; there is no `SPOOL` and no
`EXPORTS`.

**A source map is keyed by the release id, never by the version.** A version may
legally hold a `/` or a `+`, and a key with either in it would not survive a
filesystem. The upload must name a release that already exists, so the count on that
release cannot drift, and re-uploading a name replaces it without raising the count.
The body is **checked, not parsed**: the first 4 KB must open a JSON object and name
`mappings` or `sections`, and a declared `version` must be 3. Parsing megabytes of JSON
does not fit a Worker's CPU budget, and the map is parsed where it is used.

**Recording a release is idempotent.** Sending the same version again returns the row
that already exists with `created: false`, keeps the earliest `releasedAt` (`least`, the
same rule as an issue's `first_seen_at`) and never drops a commit it already knows. A CI
job that reruns must not look like a new deploy, and must not fail either.

**What the log store said is never what the caller is told.** A failed query answers
`503 upstream_unavailable` with a fixed sentence; the real exception, which can quote a
column name or a bound value, goes to the Worker log. The same applies to Postgres.

## Paging, and why the two halves differ

`issues` have an id, so they page by cursor on `(last_seen_at, id)`: pass back the
`nextCursor` of the page you just read. `logs` have no identity at all — the sort key is
`(project_id, environment_id, timestamp)` and nothing separates two rows written in the
same millisecond — so they page by period: narrow `to` to the oldest `timestamp` you
received and drop what you have already seen. Inventing a tiebreaker the data does not
carry would be worse than saying this.

## Limits

A period is at most 31 days. A page of logs is at most 1 000 rows, a page of issues at
most 200. A histogram is at most 1 500 points, which is what makes `bucket=1m` over a
month a `400` rather than a query that ties ClickHouse up. The per-key rate limit is a
**burst brake and not a quota**: a Worker runs many isolates and the counter lives in
one of them, so the real ceiling is the configured number times however many isolates
are awake.

## Running it

```
pnpm --filter @apps/api serve     # against the dev stack, on :8789
```

`serve.ts` reads the keys from `.nekolog-seed.json` and talks to Postgres over TCP with
`postgres`. `serve-self-host.ts` is the same thing inside the container, listening on
every interface because the Caddy in front of it is the only thing that can reach it.

Until 2026-11-05 there was a third entry, a Cloudflare Worker that read the keys from
Workers KV and reached Postgres over HTTP with Neon's driver. It went with item D4,
along with the `SqlRunner` implementation that existed only for it.

## Environment

| Name | Where | What for |
| --- | --- | --- |
| `CLICKHOUSE_URL`, `CLICKHOUSE_DB` | both | Where the logs are. |
| `CLICKHOUSE_READ_USER`, `CLICKHOUSE_READ_PASSWORD` | both | **Secrets.** `nekolog_reader`. |
| `DATABASE_URL` | both | **Secret.** Required: without it `/v1/issues` would quietly 404. |
| `API_REQUESTS_PER_MINUTE` | both | Optional, defaults to 120. |
| `API_PORT`, `API_HOST`, `API_SEED_FILE` | both | Defaults `8789`, `127.0.0.1`, `.nekolog-seed.json`. |
| `SOURCEMAPS_DIR` | self-host | The volume `POST /v1/sourcemaps` writes into. |

The hostname is `api.<domain>`, an A record `infra/vps` publishes at the machine, and
the Caddy there routes it to this container. Nothing here publishes a port.
