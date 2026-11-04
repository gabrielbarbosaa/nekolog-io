---
"@nekolog-io/core": minor
"@apps/ingest": minor
---

Make the ingestion fit the CPU budget it actually has.

A Worker on the free plan gets ~10 ms of CPU per request. Measured on 2026-11-04
(step 6.4), the biggest batch specification 1 allows — 500 events, 20% errors,
gzipped, every redaction rule on — cost **10.8 ms**. It did not fit, and no test
could see it, because k6 measures latency and the CPU limit hides behind network
waits.

Two changes came out of that.

**The fingerprint is memoized per batch.** The 100 `crypto.subtle.digest` calls
in that batch cost 1.2 ms, and in a burst — which is the shape an incident has —
they are all the same error. `createFingerprinter()` keys a map on the exact text
that gets hashed, so the same error is hashed once. The map lives for one batch
and never globally: a long-lived isolate would otherwise keep one that only
grows. The worst case, where every error is distinct, is unchanged.

**The SDK's default batch is 200 events, not 500.** `DEFAULT_MAX_BATCH_EVENTS`
is new in `@nekolog-io/core`; `MAX_EVENTS_PER_BATCH` is untouched, so the
protocol limit and the server are the same as before and a caller can still ask
for 500. What changed is that the default client no longer sends the worst case
without anyone choosing it. 200 events cost about 2.1 ms.

After both, the 500-event batch costs 9.1 ms. There is still no headroom at the
maximum, deliberately: asking for 500 is asking for the limit.

Redaction was **not** optimised, although it is the second biggest cost. Every
plausible optimisation there is a heuristic that skips values, and a privacy
control that quietly stops redacting is worse than one that over-redacts.

`apps/ingest` gains `src/budget.test.ts`, which measures the worst legal batch
and fails both on an absolute per-event ceiling and — machine-independently — if
cost stops growing linearly with the batch.
