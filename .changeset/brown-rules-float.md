---
"@apps/ingest": minor
---

Authenticate by API key, with origin allowlists and CORS.

The key arrives in `Authorization: Bearer` from a back end, or in `?key=` from
a browser, where `sendBeacon` cannot send headers. A secret key in the query is
refused with `secret_key_in_url` before any lookup, so not even its hash is
computed — a URL reaches proxy logs, history and referrers, so a secret that
travelled there is already leaked.

Lookup is by SHA-256 hash, never by the key itself. After the key: the
`logs:write` scope, the quota block, then the origin.

Origin allowlists apply to public keys only, since those are the ones visible
in a site's source. With a list configured, a request without an `Origin` is
refused — otherwise the list protects nothing, because whoever copies the key
sends it from curl. The subdomain wildcard checks scheme and suffix properly:
`https://*.example.com` does not accept `example.com`, `aexample.com`,
`app.example.com.attacker.test` or plain `http`.

Preflight answers 204 and echoes the asking origin, and decides nothing — the
POST is still authenticated and checked. Credentials are never granted. Errors
carry CORS headers too, so the browser SDK reads `invalid_key` instead of a
network failure it would retry forever. `traceparent` and `tracestate` are
allowed through.
