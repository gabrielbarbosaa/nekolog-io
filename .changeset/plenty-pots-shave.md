---
"@nekolog-io/core": minor
---

Add the privacy pipeline: sensitive-data removal, sampling and `beforeSend`.

Every event now goes through sampling, then `beforeSend`, then redaction.
Redaction is on by default and runs last, so a `beforeSend` hook cannot put
back what the SDK just took out. It matches sensitive attribute keys on any
segment of the flattened path, and finds card numbers (Luhn-checked), CPFs
(check digits), JWTs, `Bearer`/`Basic` credentials, credentials inside URLs and
NekoLog keys inside message, error and attribute text.

Sampling is consistent per trace, so a request is never recorded half way, and
`error`/`fatal` are never sampled away unless `sampling.alwaysFrom` is set to
`false`.

Whatever `beforeSend` returns is revalidated against the ingestion contract, so
a hook cannot produce an event the API would reject.
