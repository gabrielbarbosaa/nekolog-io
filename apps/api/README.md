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

**It reads and does nothing else.** Only `GET` is routed — a `POST` to `/v1/logs` is a
404, not a method error — and the ClickHouse credential it runs as is `nekolog_reader`,
which holds `SELECT` on one database and no grant on S3 or on `system`. There is no R2
binding in `wrangler.json` at all.

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
pnpm --filter @apps/api serve                       # against the dev stack, on :8789
node internal/deploy/src/render-cli.ts \
  --config apps/api/wrangler.json --environment dev \
  --out apps/api/wrangler.generated.json
pnpm --filter @apps/api deploy:dry-run -- --config wrangler.generated.json --env dev
```

`serve.ts` reads the keys from `.nekolog-seed.json` and talks to Postgres over TCP with
`postgres`. The Worker reads the keys from Workers KV and talks to Postgres over HTTP
with Neon's driver, behind the same `SqlRunner` interface — which is the only reason a
Worker can serve issues at all.

## Environment

| Name | Where | What for |
| --- | --- | --- |
| `KEYS` | Worker | KV namespace the key hashes live in. |
| `CLICKHOUSE_URL`, `CLICKHOUSE_DB` | both | Vars, rendered per environment. |
| `CLICKHOUSE_READ_USER`, `CLICKHOUSE_READ_PASSWORD` | both | **Secrets.** `nekolog_reader`. |
| `DATABASE_URL` | both | **Secret.** Required: without it `/v1/issues` would quietly 404. |
| `API_REQUESTS_PER_MINUTE` | both | Optional, defaults to 120. |
| `API_PORT`, `API_HOST`, `API_SEED_FILE` | Node | Defaults `8789`, `127.0.0.1`, `.nekolog-seed.json`. |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | both | **Secrets**, when ClickHouse sits behind Access. |

The hostname is not in `wrangler.json`: `api-<env>.nekolog.io` is a
`cloudflare_workers_custom_domain` in `infra/modules/environment`, next to the
ingestion's.
