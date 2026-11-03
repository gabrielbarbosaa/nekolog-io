---
'@nekolog-io/express': minor
'@nekolog-io/fastify': minor
'@nekolog-io/hono': minor
'@nekolog-io/node': minor
---

Add the three server middlewares — Express, Fastify and Hono — over one shared implementation in `@nekolog-io/node`: `startRequest` (continue the caller's trace, mint or validate the request id, answer with both), `levelForStatus`, `requestIdFrom` and the access line. The incoming `x-request-id` is accepted only as up to 64 characters of `[A-Za-z0-9._:-]` and otherwise replaced, because that value goes straight back out in a response header. The access line names the **route pattern**, never the address, or every id would become its own route. Express wraps the `finish` listener in `bindContext`, since an event listener does not inherit the `AsyncLocalStorage` of whoever registered it — there is a test that fires `finish` from outside the context on purpose, which is the only way to tell. Hono records in a `finally`, so a middleware further down that throws still gets its line and the error still travels. The Fastify plugin carries `skip-override`, or its hooks would be encapsulated and log nothing outside the `register` scope, and it calls `done()` inside `runWithContext` so the context reaches the handler. `withErrorLog` logs and calls `next(error)`: deciding the error response belongs to the app, and a failure in our logging must not swallow the app's error. `examples/express` now uses the package instead of its own copy.
