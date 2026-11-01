---
'@internal/seed': minor
'@internal/adapters': patch
'@apps/ingest': patch
---

Add the seed command that creates an organization, a project, its environments and their API keys before the dashboard exists. The document it writes holds only key hashes, never a key in the clear; `add-key` is both the rotation path the plan asks for and the way back when a key is lost.

`internal/adapters` relative imports now carry the `.ts` extension like the rest of the repo. Without it the package could only be loaded by a bundler, so the first command to import it under plain Node failed to resolve.
