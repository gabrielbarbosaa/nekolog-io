---
'@apps/ingest': minor
---

Add `examples/express`: an Express API that sends real logs through the ingestion into ClickHouse, which is the milestone M1 criterion. It carries the request context with `AsyncLocalStorage`, continues a W3C `traceparent` the caller sent without trusting its contents, writes one access line per request with the matched route rather than the path the caller chose, keeps internal error messages out of the response, and strips the fields this domain treats as personal before anything leaves the process.

`@apps/ingest` gains a Node entry point, `pnpm --filter @apps/ingest serve`, plus the exported `startLocalIngest`. It is the same Hono application the Worker serves, with the keys read from the seed document instead of Workers KV and no spool, so the whole path can run locally without Cloudflare.
