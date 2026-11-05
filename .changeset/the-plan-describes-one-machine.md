---
"@apps/ingest": patch
"@apps/web": patch
"@internal/load": patch
---

Rewrite the plan for the machine that exists, and give the CPU budget its real
owner.

`docs/PLANO.md` still described Cloudflare Workers, Workers KV, R2, a Tunnel,
Access, an Oracle VM, Neon, Upstash and Vercel — all removed by item D4 — and
still called the product open-core under MIT, which item A1 settled days
earlier. Sections 1, 2, 3, 4, 5, 9, 10, 11, 14, 15, 17, 18, 19, 21, 22 and 23
now describe one VPS: containers behind a Caddy, file-backed stores, an
in-process scheduler, backups to a bucket that is not the machine's.

The 10 ms CPU budget per request kept its value and changed its meaning.
It was the Cloudflare Workers free-plan ceiling, a platform limit. The VPS
imposes none, but it is **one vCPU** shared with ClickHouse, Postgres, four
Node processes and the proxy, so CPU spent in the ingestion is CPU taken from
the database it is about to query. The number stays as a self-imposed ceiling
and `WORKER_CPU_BUDGET_MS` becomes `CPU_BUDGET_MS`; `WORKER_REQUESTS_PER_DAY`
and `WORKER_REQUESTS_PER_MINUTE` described a quota that no longer exists and
are gone, which also means `affordableEvents` now returns 0 on a cost that is
not a cost instead of falling back to one of them.

The landing page told the same story in three languages with the word
"Worker" in it. The measurement, the 500, the 200 and the test that guards
them are unchanged; only the reason is.

The runbooks are deliberately not part of this: they tell you to open the
Cloudflare Zero Trust panel and branch the Neon database, and rewriting them
before the machine exists would produce the draft their own README warns
against. They go with items B2 and B3.
