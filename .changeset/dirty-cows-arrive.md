---
"@apps/ingest": minor
---

First version of the ingestion API: `POST /v1/logs` and `GET /health` on Hono.

Validates against the payload contract, keeps the valid events when some in the
batch are not, and answers with the stable error codes. Authentication is
resolved before the body is read, so an unauthenticated caller cannot make the
server buffer half a megabyte.

Three size ceilings guard the batch: the declared `Content-Length`, the body
read itself, and the output of the gzip decompressor. The last one is the one
that matters — a 2 KB gzip that expands to 4 MB clears the first two without
effort. The read stops at the first byte past the limit rather than finishing
the job of filling memory.

`projectId` and `environmentId` come only from the key, never from the payload.

`createIngestApp` requires an authenticator and a sink, so an app that accepts
anyone or silently drops logs cannot be built. The key store lands in step 1.8
and the ClickHouse writer in 1.9.
