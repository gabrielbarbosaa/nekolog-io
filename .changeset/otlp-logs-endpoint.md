---
'@apps/ingest': minor
---

Accept OTLP/HTTP logs at `POST /v1/otlp/logs`.

The body is translated into specification 1 **before anything else**, so an
OTLP record goes through exactly the same validation, fingerprinting, minimum
level, sampling and redaction as a native one. There is no second ingestion
path to keep in step — a test sends the same error twice over OTLP and asserts
both rows share one fingerprint.

**The answer is `200` with `partialSuccess`, not `202`.** That is what the OTLP
specification requires and what an exporter is built to read; answering with
our own shape would make every collector treat a success as a failure. A record
that cannot be read is counted in `rejectedLogRecords` instead of failing the
whole request, which is the same rule as "an invalid event does not bring down
the batch".

**`timeUnixNano` is read with `BigInt`.** It has been larger than
`Number.MAX_SAFE_INTEGER` since 2001, so reading it as a number silently loses
milliseconds — and after 4.11 a timestamp that drifts is not a cosmetic
problem, it decides which partition the row lands in.

Severity follows the specification's four-wide bands and falls back to
`severityText`, then to `info`; the service, release and runtime come from
`service.name`, `service.version` and `telemetry.sdk.language`. An `AnyValue`
is read to three levels deep and no further, because a deeply nested attribute
is an easy way to spend a Worker's whole CPU budget.

One thing OTLP cannot give us: **a batch id**. The protocol has no idempotency
key, so the server mints one and a retried OTLP send writes twice. The native
route avoids that by carrying its own; the specification now says so plainly
rather than leaving it to be discovered.
