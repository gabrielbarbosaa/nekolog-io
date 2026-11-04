---
"@apps/docs": minor
---

Document what shipped: the public API, the search language, OTLP, alerts,
privacy and versioning — in all three languages.

Six pages were missing for things that exist and work. The public read API had
no reference at all, so the only way to learn its routes was to read the
OpenAPI it serves. The **search language** was referenced by the quickstart, the
guides and the self-host page and documented nowhere. The **OTLP endpoint** had
shipped with no page, so nobody would know it was there. **Alerts** had five
rule types, a webhook signature and an SSRF guard, none of it written down.

The other two are the ones a user has to be able to find before trusting a
logging platform with their data: **what is stored** — the IP that is never
written, what the SDK removes before it leaves the process, what the server
removes again, and how retention is enforced by the server's clock rather than
the client's — and **versioning and support**, which is what a change to any of
this promises and how long an old version keeps working.

`apps/api/src/documented.test.ts` reads those pages in all three languages and
fails if they drift from the code: every error code with its status, every
parameter each route takes, every histogram bucket, every search field, and the
limits — 1000 rows, 200 issues, 1500 points, 120 requests a minute, 31 days,
8 MB, 200 maps, and the three the search language sets. A number in the
documentation is now pinned to the constant that enforces it.
