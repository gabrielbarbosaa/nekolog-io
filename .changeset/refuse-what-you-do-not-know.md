---
"@apps/api": minor
"@apps/ingest": patch
---

Refuse a query parameter the route does not have, and stop a browser sniffing an
API answer.

The security review of step 6.5 found that the public read API **ignored every
query parameter it did not know**. `GET /v1/logs?period=7d` answered `200` with
the default one-hour window, and the caller had no way to tell they had searched
something other than what they asked for. The same held for
`?project=prj_2` — harmless, because the scope has always come from the key, but
indistinguishable from a request that worked.

It is the same rule the search language already follows for `env:`: a filter that
silently does nothing reads like a filter that works. So an unknown parameter is
now a `400 invalid_query` naming it and naming the ones the route does take, and
`params.test.ts` pins each route's list against the OpenAPI the API publishes, so
the guard and the document cannot drift. `?key=` is still refused first, by the
authenticator, with its own message.

The OWASP ZAP scan of the same step found two missing headers. Both apps now
send `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`, and the
read API also sends `Cross-Origin-Resource-Policy: same-origin`, all from
`@internal/security-headers` rather than a second source. `nosniff` is the one
that matters: the read API returns log content, which is untrusted input, and a
browser that sniffed that body as HTML would run it.

The ingestion deliberately does **not** send `Cross-Origin-Resource-Policy`. Its
body is `{"accepted":N}`, so there is nothing to protect from cross-origin
embedding, and it is the only route with a browser client, whose `sendBeacon`
flush happens during page unload and cannot be retried. The reason is written
down in `docs/security/zap/ingest.conf`.

Both header sets are tested on the refusals too — 400, 404, 429 and 503 — which
is where a body is least expected.
