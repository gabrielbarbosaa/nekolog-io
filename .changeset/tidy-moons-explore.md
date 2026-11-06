---
'@apps/dashboard': minor
---

The log explorer: a virtualised table, the search language, the period, the
environment, the detail of one line as text, and all of it in the address bar.

This is the first time the dashboard reads ClickHouse. Every query goes through
the builders in `@nekolog-io/clickhouse/search`, so each value is bound — the
attribute's own name included — and the read uses the credential that may only
read. The environments a query may touch come from the server's list rather than
from the request, a query parameter this build does not know is refused instead
of ignored, and a failed query answers one fixed sentence: a ClickHouse
exception can quote a column or a bound value, while the search parser's message
is the caller's own text and is handed back.

The table draws without a single inline style, because the policy carries no
nonce a style attribute could use: every row keeps the same fixed box and only
the visible window is filled.
