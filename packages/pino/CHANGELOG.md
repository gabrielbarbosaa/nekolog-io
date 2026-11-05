# @nekolog-io/pino

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

- [#153](https://github.com/gabrielbarbosaa/nekolog-io/pull/153) [`487cee6`](https://github.com/gabrielbarbosaa/nekolog-io/commit/487cee612edcfd4c4a01d5c445d3cf7e4c2845af) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add the two log-library bridges. `@nekolog-io/pino` is a **destination**, not a worker-thread transport: pino's transports run in a separate worker, which would mean a second logger, a second queue and a second flush to get right on shutdown, while a destination keeps the batching the service already has and lets `pino.multistream` go on writing to stdout. `@nekolog-io/winston` is a `TransportStream` that reads the level from `Symbol.for('level')`, where winston keeps the real one, and understands both the npm and the syslog level sets. Both refuse to lose anything: pino puts the serialised `err` in the event's error and keeps its `msg` in a `log.msg` attribute when the two differ, and winston takes the error's type and message from the first line of `info.stack` — because `log.error('payment failed', err)` makes winston **concatenate** the two into `info.message`, and reading the error from there would give it a message it never had. The pino stream handles a line split across writes, stops buffering at 1 MB instead of growing without end, and skips a line that is not JSON after reporting it; the winston transport calls `next()` even when our logger throws, since a transport that does not call back stalls the whole chain.

### Patch Changes

- Updated dependencies [[`a47c3ec`](https://github.com/gabrielbarbosaa/nekolog-io/commit/a47c3ecc1f424660635257625d7ab1a15d13fce2), [`819d6fc`](https://github.com/gabrielbarbosaa/nekolog-io/commit/819d6fcbaefe135ff7e777ed5f7b6d84ac664120), [`1b75ff9`](https://github.com/gabrielbarbosaa/nekolog-io/commit/1b75ff901f0ae96814da958a1e7ae25e8fb76e2f), [`b1b2af6`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b1b2af6a3323548280ae035d0b2c1a8d51cf05b5), [`7cf3601`](https://github.com/gabrielbarbosaa/nekolog-io/commit/7cf36016f14662a672e3db55b1eed10d6310d4d2), [`d079114`](https://github.com/gabrielbarbosaa/nekolog-io/commit/d07911460be593d83d87543da3131d824585fa94), [`b8bf9ba`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b8bf9badfd7079c09966b87d8a5db172954c813c), [`5f26ab2`](https://github.com/gabrielbarbosaa/nekolog-io/commit/5f26ab2ff5fc117df13d1c0e949451c98c54733d), [`6a43ea9`](https://github.com/gabrielbarbosaa/nekolog-io/commit/6a43ea95c5d0d4b371f0caf83cf6af0cef906631)]:
  - @nekolog-io/core@1.0.0
