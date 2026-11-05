# @nekolog-io/node

## 1.0.0

### Major Changes

- Leave `0.x`.
  
  Nothing in this release breaks anything, because there is nothing to break: no
  version of any of these packages has ever been published. The major is what
  `0.x` means being over — from here the promises on
  [versioning and support](https://nekolog.io/docs/reference/versioning/) hold.
  A breaking change to the HTTP API becomes `/v2` and `/v1` keeps answering for at
  least six months; the ingestion accepts the two most recent `schemaVersion`
  values; anything being removed from a package gets a console warning and a
  changelog entry at least one minor before it goes.
  
  Two things changed in the code to make that a promise and not a sentence.
  
  **Every published package now ships a CycloneDX bill of materials**, written
  from the lockfile at release time and attached to that package's own GitHub
  Release. The documents list what the package brings, not what the application
  already has, and a check refuses a release where one is missing, left over from
  the version before, or describes something this release does not publish. Three
  of them — `core`, `cli` and `adapters` — promise **no runtime dependencies at
  all**, and that promise used to live only in prose; the bill of materials now
  answers it, so a transitive dependency arriving through a package they already
  use fails the release instead of shipping.
  
  **Publishing uses npm trusted publishing**, so there is no npm token in this
  repository or in GitHub to leak, and every tarball carries provenance naming the
  commit and the workflow that built it.
  
  `apps/api` and `apps/ingest` now answer `/health` with the version they were
  deployed as, the way `apps/jobs` already did — the plan has said the version
  shows at `/health` since the beginning, and on two of the three it did not.

### Minor Changes

- [#35](https://github.com/gabrielbarbosaa/nekolog-io/pull/35) [`a47c3ec`](https://github.com/gabrielbarbosaa/nekolog-io/commit/a47c3ecc1f424660635257625d7ab1a15d13fce2) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - First release of `@nekolog-io/node`.
  
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

- [#151](https://github.com/gabrielbarbosaa/nekolog-io/pull/151) [`7202528`](https://github.com/gabrielbarbosaa/nekolog-io/commit/7202528cd717f7b3684a8562fc6983c76a466f31) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add the three server middlewares — Express, Fastify and Hono — over one shared implementation in `@nekolog-io/node`: `startRequest` (continue the caller's trace, mint or validate the request id, answer with both), `levelForStatus`, `requestIdFrom` and the access line. The incoming `x-request-id` is accepted only as up to 64 characters of `[A-Za-z0-9._:-]` and otherwise replaced, because that value goes straight back out in a response header. The access line names the **route pattern**, never the address, or every id would become its own route. Express wraps the `finish` listener in `bindContext`, since an event listener does not inherit the `AsyncLocalStorage` of whoever registered it — there is a test that fires `finish` from outside the context on purpose, which is the only way to tell. Hono records in a `finally`, so a middleware further down that throws still gets its line and the error still travels. The Fastify plugin carries `skip-override`, or its hooks would be encapsulated and log nothing outside the `register` scope, and it calls `done()` inside `runWithContext` so the context reaches the handler. `withErrorLog` logs and calls `next(error)`: deciding the error response belongs to the app, and a failure in our logging must not swallow the app's error. `examples/express` now uses the package instead of its own copy.

- [#148](https://github.com/gabrielbarbosaa/nekolog-io/pull/148) [`6a43ea9`](https://github.com/gabrielbarbosaa/nekolog-io/commit/6a43ea95c5d0d4b371f0caf83cf6af0cef906631) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Propagate W3C `traceparent`, and only to the domains that were configured. The parsing and formatting now live in `@nekolog-io/core` — `parseTraceparent`, `traceparentOf`, `traceForRequest`, `childSpan` and `createTraceTargetMatcher` — so the browser, Node and the Express example stop carrying three copies of the same spec. In the browser every log on the page carries the same trace and every request gets a child span, which is what puts a click on the front end and the request on the back end in one timeline; the default target is the page's own origin, because a `traceId` is an internal identifier and an extra header on a cross-origin request turns it into a preflight that can simply fail. Matching is strict on purpose: whole-host or whole-origin equality, `.example.com` for subdomains, an optional path that must match a segment boundary, `http:`/`https:` only, and never the ingestion endpoint. In Node `installTracePropagation({targets})` reads the trace from the request's `AsyncLocalStorage` context and has **no default**: there is no "own origin" on a server, and silently sending internal trace ids to a payment gateway is not a default anybody wants. Adding the header never breaks the request — `Headers`, pair lists, plain objects and a prepared `Request` are each extended rather than replaced, and anything unexpected means the request goes out without the header instead of not going out.

### Patch Changes

- [#150](https://github.com/gabrielbarbosaa/nekolog-io/pull/150) [`416241f`](https://github.com/gabrielbarbosaa/nekolog-io/commit/416241f1d63589a40afb3204920dd8862cc5be84) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add `@nekolog-io/next`: `register()` for `instrumentation.ts`, `onRequestError` for the errors Next hands back, and `@nekolog-io/next/client` for the browser half. The two entries are not tidiness — the server entry pulls `node:async_hooks` through `@nekolog-io/node` and would break a client bundle, so importing the wrong one fails immediately instead of in production. `register()` builds one logger per process however many times Next calls it, uses the Node logger with process hooks on the `nodejs` runtime and a core logger with `runtime: 'edge'` and no hooks on `edge`, and treats an unknown `NEXT_RUNTIME` as `nodejs` rather than believing it. `onRequestError` records the path without its query string, the method and the Next routing fields, and **never the headers** — that is where the session cookie and the `Authorization` live, with a test for each. If the logger itself fails the handler does not throw back into Next: the error being handled matters more than ours. `@nekolog-io/node` now accepts an `sdk` override, which is how this package names itself.
- Updated dependencies [[`a47c3ec`](https://github.com/gabrielbarbosaa/nekolog-io/commit/a47c3ecc1f424660635257625d7ab1a15d13fce2), [`819d6fc`](https://github.com/gabrielbarbosaa/nekolog-io/commit/819d6fcbaefe135ff7e777ed5f7b6d84ac664120), [`1b75ff9`](https://github.com/gabrielbarbosaa/nekolog-io/commit/1b75ff901f0ae96814da958a1e7ae25e8fb76e2f), [`b1b2af6`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b1b2af6a3323548280ae035d0b2c1a8d51cf05b5), [`7cf3601`](https://github.com/gabrielbarbosaa/nekolog-io/commit/7cf36016f14662a672e3db55b1eed10d6310d4d2), [`d079114`](https://github.com/gabrielbarbosaa/nekolog-io/commit/d07911460be593d83d87543da3131d824585fa94), [`b8bf9ba`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b8bf9badfd7079c09966b87d8a5db172954c813c), [`5f26ab2`](https://github.com/gabrielbarbosaa/nekolog-io/commit/5f26ab2ff5fc117df13d1c0e949451c98c54733d), [`6a43ea9`](https://github.com/gabrielbarbosaa/nekolog-io/commit/6a43ea95c5d0d4b371f0caf83cf6af0cef906631)]:
  - @nekolog-io/core@1.0.0
