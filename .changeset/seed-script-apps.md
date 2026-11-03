---
'@internal/seed': minor
'@apps/ingest': patch
---

Add the seed command that creates an organization, a project, its environments and their API keys before the dashboard exists. The document it writes holds only key hashes, never a key in the clear; `add-key` is both the rotation path the plan asks for and the way back when a key is lost.
