---
"@nekolog-io/core": minor
---

Add `contextProvider`, a hook read on every log instead of captured once.

It lets a platform SDK inject ambient context without the logger being rebuilt
per request. The ambient context sits underneath the logger's own, so anything
passed to `child()` or to the call wins. A provider that throws does not cost
the log: the event goes without the ambient context and `onError` is told.
