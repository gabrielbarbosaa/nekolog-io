---
'@internal/tracking': patch
---

Pass the issue body to `gh` as an argument instead of through stdin. Async `execFile` has no `input` option, so `gh issue create --body-file -` waited on a stdin that was never written and the run hung without creating anything. Every `gh` call now also has a 30 s timeout.
