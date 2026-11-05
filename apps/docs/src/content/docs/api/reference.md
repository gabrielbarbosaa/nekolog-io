---
title: Public API reference
description: Read your logs, their histogram and your issues with a secret key, and record what you deployed.
---

:::caution[Not on npm yet]
The `@nekolog-io/*` packages have not been published, and no instance is hosted
yet. This page describes the behaviour the code already has, so the shape of the
API is clear.
:::

Everything the dashboard shows, you can read yourself. The API serves its own
OpenAPI document at `/openapi.json`, built against the origin you asked it from,
so you can point a generator or [OWASP ZAP](https://www.zaproxy.org/) straight
at it.

```bash
curl https://api.nekolog.io/v1/logs?limit=20 \
  -H "Authorization: Bearer $NEKOLOG_KEY"
```

## The key decides what you can see

A secret key names exactly one project and one environment. The server takes the
scope from the key and from nothing else — there is no `project` parameter, and
there will not be one. To read another environment, use that environment's key.

| | |
|---|---|
| Header | `Authorization: Bearer nekolog_sk_…` |
| Reading | needs the `logs:read` scope |
| Writing | needs `logs:write`, and refuses a public key by its prefix |

Three things are refused before anything else happens:

- **A key in the URL.** `?key=…` is turned away with `secret_key_in_url`, even a
  blank one, even next to a valid header — and the key's hash is never even
  computed. The ingestion accepts `?key=` on one path only, because
  `navigator.sendBeacon` cannot send a header while a page unloads. Nothing here
  is a beacon.
- **A public key.** It ships in every browser bundle.
- **`env:` inside a search.** The key already names one environment. A filter
  that silently does nothing reads like a filter that works, so this is a `400`
  rather than a shrug.

## Routes

Only `GET` is routed on the read routes, so a `POST /v1/logs` is a `404` and not
a method error.

| Route | What it does |
|---|---|
| `GET /health` | Whether this deployment is up, and which version it is. No key needed. |
| `GET /openapi.json` | This API, described. No key needed. |
| `GET /v1/logs` | Search. |
| `GET /v1/histogram` | Counts per bucket and level, for a chart. |
| `GET /v1/issues` | Errors grouped by fingerprint. |
| `POST /v1/releases` | Record that a version went out. |
| `POST /v1/sourcemaps` | Upload one `.map` for a release. |

### `GET /v1/logs`

| Parameter | |
|---|---|
| `from`, `to` | ISO 8601 or epoch milliseconds. Defaults to the last hour. |
| `q` | A [search](/docs/api/search/). |
| `limit` | 1 to 1000, default 100. |
| `order` | `newest` (default) or `oldest`. |

### `GET /v1/histogram`

Takes `from`, `to` and `q`, plus `bucket`: one of `1m`, `5m`, `15m`, `1h`, `6h`
or `1d`. A period that would need more than 1500 points is refused — ask for a
wider bucket or a shorter period.

### `GET /v1/issues`

| Parameter | |
|---|---|
| `limit` | 1 to 200, default 50. |
| `status` | `open`, `resolved` or `ignored`, repeatable or comma-separated. |
| `cursor` | From the previous page's `nextCursor`. |
| `since`, `until` | Bound by when the issue was last seen. |

### Writing

Both write routes are what a deploy job calls, and the
[CLI](/docs/guides/cli/) and the
[bundler plugin](/docs/guides/bundler-plugin/) call them for you.

`POST /v1/releases` takes `{ version, commit?, releasedAt? }` and is
**idempotent**: the same version again keeps the moment it first went out and
never drops a commit it already knows, so rerunning a pipeline is free.

`POST /v1/sourcemaps?release=<version>&name=<file>.map` takes the map as the
body. The release has to exist already, the name is a single segment matching
`^[A-Za-z0-9][A-Za-z0-9._-]*\.map$`, and the body is at most 8 MB. Re-uploading
a name replaces it without raising the count, and a release holds at most 200
maps.

## Paging

**Issues page by cursor.** An issue has an id, so the reader keysets on
`(last_seen_at, id)` and hands back a `nextCursor`. Pass it back to get the next
page; `null` means that was the last one.

**Logs page by period.** A log line has no row identity — nothing separates two
rows written in the same millisecond — so there is no cursor to give you. Narrow
`to` to the oldest timestamp you have and ask again. That is a real property of
the data, not a gap in the API.

## Limits

| | |
|---|---|
| Period | at most 31 days per request |
| Histogram | at most 1500 points |
| Rate | 120 requests per minute per key, with `Retry-After` on a `429` |

Every answer carries `Cache-Control: no-store` and
`X-Content-Type-Options: nosniff`. Nothing between you and the API should be
keeping your logs.

## Errors

The body is always the same shape:

```json
{ "error": { "code": "invalid_query", "message": "…", "retryAfter": null } }
```

| Code | Status | |
|---|---|---|
| `invalid_key` | 401 | No key, unknown key, or a public one. |
| `secret_key_in_url` | 401 | The key was in the query string. |
| `insufficient_scope` | 403 | The key cannot do this. |
| `invalid_query` | 400 | A parameter, a search or a cursor the route will not take. |
| `period_too_long` | 400 | Over 31 days. |
| `not_found` | 404 | No such route, or this deployment does not serve it. |
| `unsupported_media_type` | 415 | The body is not what the route reads. |
| `payload_too_large` | 413 | Over the limit for that route. |
| `rate_limited` | 429 | Come back after `retryAfter` seconds. |
| `upstream_unavailable` | 503 | The log store did not answer. |
| `internal_error` | 500 | Something else. |

**A parameter the route does not have is an error**, not something ignored. The
message names what it did not recognise and what the route does take, so a typo
never looks like a query that worked.

A `503` answers a fixed sentence on purpose: the real exception can quote a
column or a bound value, so it goes to the server's log instead of to you.

## Where it runs

The same app serves on Cloudflare Workers and as a plain Node process, which is
what the [self-host](/docs/self-host/install/) runs on port 8789. On Workers it
reaches Postgres over HTTP, which is the only reason a Worker can serve issues
at all.
