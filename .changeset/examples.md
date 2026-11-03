---
'@nekolog-io/nestjs': minor
'@nekolog-io/next': minor
'@nekolog-io/react': patch
---

Writing the examples found two gaps in the packages. The Nest interceptor logged the access line for a 500 but **not the error**, so the stack landed nowhere; it now logs both, and `errorLog: false` turns that off. And a Next route handler has no per-request context at all — `instrumentation.ts` runs once per process and `proxy.ts` runs in another runtime, so `addContext` had no scope to write into and the user id simply never appeared. `@nekolog-io/next` now re-exports `startRequest`, `levelForStatus`, `accessMessage`, `accessAttributes` and `REQUEST_ID_HEADER`, which is what a route handler needs to open that scope itself; `examples/next` shows a ten-line wrapper that does it. `@nekolog-io/react` also exports `currentUser` and `clearUser`.
