---
'@nekolog-io/adapters': minor
'@nekolog-io/db': minor
'@apps/ingest': minor
---

Enforce an environment's minimum level and sample rate at the ingestion.

`environments` gains `min_level` and `sample_rate` (migration `0010`), both
checked in the schema, and `KeyRecord` carries them so the Worker reads them
from KV and never from Postgres. An event that does not pass never becomes a
row — this cannot be a screen setting, because a screen cannot stop a write.

**Sampling is deterministic, and seeded on the trace.** The seed is the
`traceId`, falling back to the session id, falling back to the event's place in
its batch. A whole trace is therefore kept or dropped together; sampling event
by event would leave half a trace, which is no use to anybody investigating.
The same event always gets the same answer, so a retried batch does not change
its mind.

**`error` and `fatal` are never sampled out**, whatever the rate. Losing an
error to sampling is exactly what nobody wants, and a rate set low to control
volume should cut the noise, not the signal.

The level cut runs before the sample, so a quiet event is reported as
`below_min_level` and never as `sampled_out`. A setting that makes no sense — a
level nobody defines, a rate of zero or above one, `NaN` — falls back to letting
everything through rather than silently dropping a tenant's logs.
