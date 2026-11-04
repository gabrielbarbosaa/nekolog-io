---
'@nekolog-io/adapters': minor
'@nekolog-io/db': minor
'@apps/ingest': minor
---

Remove what an environment asked to remove, at the ingestion.

`environments.redaction_rules` (migration `0011`) lets an environment turn on
named patterns — e-mail, IPv4, IPv6, Brazilian phone, CPF, CNPJ, JWT, `Bearer`,
UUID, credit card — and blank attributes by exact key or by prefix. The rules
ride on the `KeyRecord` into KV and run in the Worker **before the write**, so
what the tenant asked to remove never becomes a row.

**The tenant does not write a regular expression, and that is the point.** The
column accepts only names from a closed list, and a check constraint refuses a
key called `regex`, `pattern` or `patternSource`. A third party's regex on the
hot path of a Worker with a 10 ms CPU budget is denial of service the user
writes for you — and this codebase has already been bitten twice by an
accidentally quadratic pattern of its own.

Which is exactly what happened again while writing this: the first e-mail
pattern took **266 ms** over 16 KB of `1-1-1-…`, because `[A-Za-z0-9._%+-]+@`
backtracks the whole run from every start position. Bounding the local part to
64 characters — which is what RFC 5321 allows anyway — took it to **9.2 ms**,
and all ten patterns together now cost **5.8 ms** on the worst shape measured.
A test pins that budget.

**A stored rule that cannot be read fails closed**: the ingestion applies every
pattern it knows rather than none. A privacy control that quietly stops working
is worse than one that over-redacts, and a broken rule is a configuration error,
not a reason to write personal data in the clear.
