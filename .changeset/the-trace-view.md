---
'@apps/dashboard': minor
'@internal/schema': minor
'@nekolog-io/clickhouse': minor
---

The trace view: every log carrying the same `trace_id`, from the click in the
browser to the request in the back, on one timeline at
`/{org}/{project}/traces/{traceId}`.

`traceId` and `spanId` are now normalised to lowercase in the ingestion schema.
The hex was accepted in any case and stored verbatim on the native path while
the OTLP translator lowercased it, so the same logical trace could become two
values — `=` in ClickHouse is case-sensitive — and the timeline would have shown
half the journey without saying the other half was missing. The normalisation
lives in the schema, where both entry paths pass, rather than in whoever writes
the row.

`logTraceQuery` joins the search entry point. The trace id travels as a bound
parameter, an empty one is refused outright (every row without a trace carries
it, so it would answer with logs that have nothing to do with each other), and
the window is capped at a day because the table is partitioned by day.
