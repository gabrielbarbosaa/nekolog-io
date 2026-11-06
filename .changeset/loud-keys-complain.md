---
'@apps/dashboard': patch
'@internal/dev': patch
---

A dashboard whose signing key does not load says so. `/health` answers 503 with
the reason instead of a cheerful 200, the sign-in screen renders the message
instead of throwing an internal server error, and `pnpm dev:doctor` repeats it.
The message names the trap it was written for: a process that was already
running keeps the environment it started with, so generating a key is not enough
without a restart.
