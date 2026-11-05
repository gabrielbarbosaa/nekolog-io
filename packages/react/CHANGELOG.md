# @nekolog-io/react

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

- [#149](https://github.com/gabrielbarbosaa/nekolog-io/pull/149) [`b13e696`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b13e6969282e93083ddabbaad12d89cde908ffe1) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add `@nekolog-io/react`: `NekologProvider`, `useLogger` and an `ErrorBoundary` that logs what broke with the React component stack. The provider does not start a client per mount — it takes the page's one client, so two nested providers, StrictMode rendering everything twice, and a route that unmounts and remounts all share it with the global handlers installed once; unmounting the provider therefore closes nothing, because the page is still the page, and `closeClient()` is there for the cases that really end. `useLogger` outside a provider returns a console-backed logger and warns once rather than throwing: React's convention would be to throw, but this SDK's contract is never to throw into the host app, and a forgotten provider must not be why a production page goes blank. The boundary's `onError` runs even when the logging itself fails, the component stack is cut at 2 000 characters so one stack cannot eat the attribute budget, and `withErrorBoundary` wraps a component without writing the boundary by hand. `@nekolog-io/browser` now accepts an `sdk` override instead of always claiming to be the browser SDK, which is how the React package names itself.

### Patch Changes

- [#154](https://github.com/gabrielbarbosaa/nekolog-io/pull/154) [`f88e468`](https://github.com/gabrielbarbosaa/nekolog-io/commit/f88e468653258ea13fd9cec39b9ef4cf33116a5c) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Writing the examples found two gaps in the packages. The Nest interceptor logged the access line for a 500 but **not the error**, so the stack landed nowhere; it now logs both, and `errorLog: false` turns that off. And a Next route handler has no per-request context at all — `instrumentation.ts` runs once per process and `proxy.ts` runs in another runtime, so `addContext` had no scope to write into and the user id simply never appeared. `@nekolog-io/next` now re-exports `startRequest`, `levelForStatus`, `accessMessage`, `accessAttributes` and `REQUEST_ID_HEADER`, which is what a route handler needs to open that scope itself; `examples/next` shows a ten-line wrapper that does it. `@nekolog-io/react` also exports `currentUser` and `clearUser`.
- Updated dependencies [[`a47c3ec`](https://github.com/gabrielbarbosaa/nekolog-io/commit/a47c3ecc1f424660635257625d7ab1a15d13fce2), [`c0a3dd6`](https://github.com/gabrielbarbosaa/nekolog-io/commit/c0a3dd6c59977ed7f739d2953bba85387a4b7756), [`4966844`](https://github.com/gabrielbarbosaa/nekolog-io/commit/4966844e55d6ef6d8a7ab25865e3571e70da44d0), [`819d6fc`](https://github.com/gabrielbarbosaa/nekolog-io/commit/819d6fcbaefe135ff7e777ed5f7b6d84ac664120), [`76c33a1`](https://github.com/gabrielbarbosaa/nekolog-io/commit/76c33a15ec238d2dfd71e6ab47d6d000682c5b01), [`1b75ff9`](https://github.com/gabrielbarbosaa/nekolog-io/commit/1b75ff901f0ae96814da958a1e7ae25e8fb76e2f), [`b1b2af6`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b1b2af6a3323548280ae035d0b2c1a8d51cf05b5), [`7cf3601`](https://github.com/gabrielbarbosaa/nekolog-io/commit/7cf36016f14662a672e3db55b1eed10d6310d4d2), [`d079114`](https://github.com/gabrielbarbosaa/nekolog-io/commit/d07911460be593d83d87543da3131d824585fa94), [`b8bf9ba`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b8bf9badfd7079c09966b87d8a5db172954c813c), [`5f26ab2`](https://github.com/gabrielbarbosaa/nekolog-io/commit/5f26ab2ff5fc117df13d1c0e949451c98c54733d), [`b13e696`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b13e6969282e93083ddabbaad12d89cde908ffe1), [`6a43ea9`](https://github.com/gabrielbarbosaa/nekolog-io/commit/6a43ea95c5d0d4b371f0caf83cf6af0cef906631)]:
  - @nekolog-io/core@1.0.0
  - @nekolog-io/browser@1.0.0
