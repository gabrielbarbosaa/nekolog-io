---
"@nekolog-io/core": minor
---

Add the core logger: levels, `child()` and context.

`createLogger()` builds events in the v1 ingestion format — RFC 3339 timestamps,
UTF-8-aware message truncation, attributes flattened into dotted keys and capped
to the contract's limits, W3C-shaped traces, and errors reduced to type, message
and stack. Child loggers inherit their parent's context and add to it without
changing it.

The logger never throws into the host application: a sink that throws, a clock
that throws, an attribute getter that throws and an `onError` that throws are all
swallowed and reported through `onError`.

Zero runtime dependencies. The contract's limits are duplicated here rather than
imported, and a test runs this package's events through the real ingestion parser
to prove the two never drift.

Sending is not in this release. The batching transport, retry and a real
`flush()` arrive next; without a sink the logger writes to the console.
