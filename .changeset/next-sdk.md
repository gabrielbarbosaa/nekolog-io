---
'@nekolog-io/next': minor
'@nekolog-io/node': patch
---

Add `@nekolog-io/next`: `register()` for `instrumentation.ts`, `onRequestError` for the errors Next hands back, and `@nekolog-io/next/client` for the browser half. The two entries are not tidiness — the server entry pulls `node:async_hooks` through `@nekolog-io/node` and would break a client bundle, so importing the wrong one fails immediately instead of in production. `register()` builds one logger per process however many times Next calls it, uses the Node logger with process hooks on the `nodejs` runtime and a core logger with `runtime: 'edge'` and no hooks on `edge`, and treats an unknown `NEXT_RUNTIME` as `nodejs` rather than believing it. `onRequestError` records the path without its query string, the method and the Next routing fields, and **never the headers** — that is where the session cookie and the `Authorization` live, with a test for each. If the logger itself fails the handler does not throw back into Next: the error being handled matters more than ours. `@nekolog-io/node` now accepts an `sdk` override, which is how this package names itself.
