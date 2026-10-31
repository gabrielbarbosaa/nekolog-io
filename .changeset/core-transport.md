---
"@nekolog-io/core": minor
---

Add the batching transport: queue, retry, `Retry-After` and `flush()`.

A logger created with an `apiKey` now sends. Events queue up and leave in
batches, bounded by the contract's 500 events and 512 KB; a batch too large is
split in half until it fits, and an event that cannot fit alone is dropped and
counted rather than lost in silence. The `batchId` is a dependency-free UUID v7
and stays the same across retries, which is what lets the server deduplicate a
resend.

Retries are exponential with jitter and honour `Retry-After` exactly, in seconds
or as an HTTP date. When the server asks for longer than the backoff ceiling, the
transport pauses until that moment instead of blocking or coming back early.

`invalid_key`, `origin_not_allowed`, `secret_key_in_url` and
`unsupported_schema_version` stop the transport for good — hammering a bad key
only costs noise. `invalid_payload` and `payload_too_large` drop that batch and
carry on, and events rejected inside an accepted batch arrive on `onReject`.

The API key always travels in the `Authorization` header and never in the URL.
