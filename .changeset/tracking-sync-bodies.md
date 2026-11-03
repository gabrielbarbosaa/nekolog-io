---
'@internal/tracking': minor
---

Rewrite the body of an open issue when `docs/ETAPAS.md` has moved on. The script only ever created, so the 53 issues open on 2026-11-03 still told the reader to close them with `Closes #N`, which this repository cannot do — the `close-step-issue` workflow finds the issue by branch name because GitHub only closes a linked issue from the default branch. It still never renames, closes or deletes anything, skips closed issues, keeps an item somebody ticked by hand, and normalises `\r\n` so an unchanged issue is not rewritten on every run.
