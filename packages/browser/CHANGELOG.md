# @nekolog-io/browser

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

- [#146](https://github.com/gabrielbarbosaa/nekolog-io/pull/146) [`c0a3dd6`](https://github.com/gabrielbarbosaa/nekolog-io/commit/c0a3dd6c59977ed7f739d2953bba85387a4b7756) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Record what the person did before the error: clicks, navigation and fetch. The trail is a ring of 20 kept in memory and rides along only with `error` and `fatal`, because payload v1 has no breadcrumb field — it travels as one `breadcrumbs` attribute, capped at 4 KB, and 4 KB on each of 500 events would be a 2 MB batch the server refuses. It is trimmed from the oldest end until it fits, never mid-record, so what arrives is always valid JSON. A click records `button#pay`, never the label, because a label can name a person and `value` is what somebody typed; navigation and fetch addresses lose the query string the same way `page.url` does; the request body and headers are never read; and the SDK's own batch is skipped so a flush does not become a breadcrumb of the next one. The two monkey-patches — `window.fetch` and `history.pushState`/`replaceState` — call through, return what the original returned, rethrow what it rejected, and restore only if nobody patched after us.

- [#147](https://github.com/gabrielbarbosaa/nekolog-io/pull/147) [`4966844`](https://github.com/gabrielbarbosaa/nekolog-io/commit/4966844e55d6ef6d8a7ab25865e3571e70da44d0) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Park a batch in IndexedDB when it cannot leave the page, and send it when the network comes back — and on the next visit, without waiting for an event, so the error that happened offline and closed the tab arrives when the person opens the site again. Only a transport failure counts as an outage: a `400` is a refusal the server will repeat, so that batch is dropped rather than retried forever, and on replay `429` and `5xx` keep a batch while `4xx` deletes it. The stored record holds only `at`, `url` and `body` — the `Authorization` header is built again at replay time, because an API key in a browser database is a credential at rest for nothing. At most 50 batches, 2 MB and 7 days, oldest out first, since it is not our disk. If IndexedDB refuses the write — quota, private browsing, an aborted transaction — the original error is rethrown rather than reported as parked, which is why the transaction is awaited to completion: an `add` that succeeded and a transaction that aborted afterwards is not a saved batch.

- [#145](https://github.com/gabrielbarbosaa/nekolog-io/pull/145) [`819d6fc`](https://github.com/gabrielbarbosaa/nekolog-io/commit/819d6fcbaefe135ff7e777ed5f7b6d84ac664120) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add `@nekolog-io/browser`: uncaught errors and rejected promises, a per-tab session, `setUser`, and the batch leaving by `sendBeacon` on `pagehide`. A secret key handed to a browser is refused rather than sent, because anyone reading the page would have it. The beacon cannot carry a header, which is the whole reason the public key travels in the URL on that one path and the body goes as `text/plain` — a JSON content type would ask for a preflight that never happens while the page is unloading. `page.url` drops the query string and the fragment by default, because that is where reset tokens and coupons live. The session is a UUID in `sessionStorage` that only comes back if it still looks like one, so a poisoned entry becomes a new session instead of an attribute. `TransportTuning` gained a `fetch`, which is the seam the browser transport sends through.

- [#148](https://github.com/gabrielbarbosaa/nekolog-io/pull/148) [`6a43ea9`](https://github.com/gabrielbarbosaa/nekolog-io/commit/6a43ea95c5d0d4b371f0caf83cf6af0cef906631) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Propagate W3C `traceparent`, and only to the domains that were configured. The parsing and formatting now live in `@nekolog-io/core` — `parseTraceparent`, `traceparentOf`, `traceForRequest`, `childSpan` and `createTraceTargetMatcher` — so the browser, Node and the Express example stop carrying three copies of the same spec. In the browser every log on the page carries the same trace and every request gets a child span, which is what puts a click on the front end and the request on the back end in one timeline; the default target is the page's own origin, because a `traceId` is an internal identifier and an extra header on a cross-origin request turns it into a preflight that can simply fail. Matching is strict on purpose: whole-host or whole-origin equality, `.example.com` for subdomains, an optional path that must match a segment boundary, `http:`/`https:` only, and never the ingestion endpoint. In Node `installTracePropagation({targets})` reads the trace from the request's `AsyncLocalStorage` context and has **no default**: there is no "own origin" on a server, and silently sending internal trace ids to a payment gateway is not a default anybody wants. Adding the header never breaks the request — `Headers`, pair lists, plain objects and a prepared `Request` are each extended rather than replaced, and anything unexpected means the request goes out without the header instead of not going out.

### Patch Changes

- [#155](https://github.com/gabrielbarbosaa/nekolog-io/pull/155) [`76c33a1`](https://github.com/gabrielbarbosaa/nekolog-io/commit/76c33a15ec238d2dfd71e6ab47d6d000682c5b01) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - `createLogger` now takes the `fetch` from `transport.fetch` as well as from the top-level `fetch` option. It used to build its own sender and silently throw away a `transport.fetch` the caller passed — which is the shape every other SDK in this repo accepts, so passing it and getting nothing was a trap. The compatibility smoke test walked straight into it.

- [#149](https://github.com/gabrielbarbosaa/nekolog-io/pull/149) [`b13e696`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b13e6969282e93083ddabbaad12d89cde908ffe1) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add `@nekolog-io/react`: `NekologProvider`, `useLogger` and an `ErrorBoundary` that logs what broke with the React component stack. The provider does not start a client per mount — it takes the page's one client, so two nested providers, StrictMode rendering everything twice, and a route that unmounts and remounts all share it with the global handlers installed once; unmounting the provider therefore closes nothing, because the page is still the page, and `closeClient()` is there for the cases that really end. `useLogger` outside a provider returns a console-backed logger and warns once rather than throwing: React's convention would be to throw, but this SDK's contract is never to throw into the host app, and a forgotten provider must not be why a production page goes blank. The boundary's `onError` runs even when the logging itself fails, the component stack is cut at 2 000 characters so one stack cannot eat the attribute budget, and `withErrorBoundary` wraps a component without writing the boundary by hand. `@nekolog-io/browser` now accepts an `sdk` override instead of always claiming to be the browser SDK, which is how the React package names itself.
- Updated dependencies [[`a47c3ec`](https://github.com/gabrielbarbosaa/nekolog-io/commit/a47c3ecc1f424660635257625d7ab1a15d13fce2), [`819d6fc`](https://github.com/gabrielbarbosaa/nekolog-io/commit/819d6fcbaefe135ff7e777ed5f7b6d84ac664120), [`1b75ff9`](https://github.com/gabrielbarbosaa/nekolog-io/commit/1b75ff901f0ae96814da958a1e7ae25e8fb76e2f), [`b1b2af6`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b1b2af6a3323548280ae035d0b2c1a8d51cf05b5), [`7cf3601`](https://github.com/gabrielbarbosaa/nekolog-io/commit/7cf36016f14662a672e3db55b1eed10d6310d4d2), [`d079114`](https://github.com/gabrielbarbosaa/nekolog-io/commit/d07911460be593d83d87543da3131d824585fa94), [`b8bf9ba`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b8bf9badfd7079c09966b87d8a5db172954c813c), [`5f26ab2`](https://github.com/gabrielbarbosaa/nekolog-io/commit/5f26ab2ff5fc117df13d1c0e949451c98c54733d), [`6a43ea9`](https://github.com/gabrielbarbosaa/nekolog-io/commit/6a43ea95c5d0d4b371f0caf83cf6af0cef906631)]:
  - @nekolog-io/core@1.0.0
