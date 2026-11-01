---
'@internal/schema': patch
'@nekolog-io/core': patch
'@apps/ingest': patch
---

Fuzz the ingestion validator, the body reader and the SDK-to-ingest contract with fast-check, and pin the limits of specification 1 to their documented values instead of only to each other.

`internal/schema` relative imports now carry the `.ts` extension, like the rest of the repo.
