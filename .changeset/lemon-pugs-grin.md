---
"@nekolog-io/node": minor
---

First release of `@nekolog-io/node`.

Per-request context with `AsyncLocalStorage` (`runWithContext`, `addContext`,
`bindContext`), so the logger does not have to be rebuilt or threaded through a
call stack, and concurrent requests never mix.

`installProcessHooks` logs and flushes on `uncaughtException`,
`unhandledRejection`, `SIGTERM`, `SIGINT` and `beforeExit`. It is an explicit
call, not something creating a logger does, and it preserves Node's own
behaviour: the stack still reaches stderr and the process still exits 1. When
the app has its own handler for the event, the SDK flushes and stays out of the
way instead of deciding the shutdown. The flush is bounded by `flushTimeoutMs`
so a stalled network cannot hold a deploy open.

Reads `NEKOLOG_KEY`, `NEKOLOG_ENDPOINT`, `NEKOLOG_SERVICE`, `NEKOLOG_RELEASE`
and `NEKOLOG_LEVEL` when the matching option is absent.
