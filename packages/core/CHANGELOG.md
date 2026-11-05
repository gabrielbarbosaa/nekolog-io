# @nekolog-io/core

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

- [#35](https://github.com/gabrielbarbosaa/nekolog-io/pull/35) [`a47c3ec`](https://github.com/gabrielbarbosaa/nekolog-io/commit/a47c3ecc1f424660635257625d7ab1a15d13fce2) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add `contextProvider`, a hook read on every log instead of captured once.
  
  It lets a platform SDK inject ambient context without the logger being rebuilt
  per request. The ambient context sits underneath the logger's own, so anything
  passed to `child()` or to the call wins. A provider that throws does not cost
  the log: the event goes without the ambient context and `onError` is told.

- [#31](https://github.com/gabrielbarbosaa/nekolog-io/pull/31) [`1b75ff9`](https://github.com/gabrielbarbosaa/nekolog-io/commit/1b75ff901f0ae96814da958a1e7ae25e8fb76e2f) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add the core logger: levels, `child()` and context.
  
  `createLogger()` builds events in the v1 ingestion format — RFC 3339 timestamps,
  UTF-8-aware message truncation, attributes flattened into dotted keys and capped
  to the contract's limits, W3C-shaped traces, and errors reduced to type, message
  and stack. Child loggers inherit their parent's context and add to it without
  changing it.
  
  The logger never throws into the host application: a sink that throws, a clock
  that throws, an attribute getter that throws and an `onError` that throws are all
  swallowed and reported through `onError`.
  
  Zero runtime dependencies. The contract's limits are duplicated here rather than
  imported, and a test runs this package's events through the real ingestion parser
  to prove the two never drift.
  
  Sending is not in this release. The batching transport, retry and a real
  `flush()` arrive next; without a sink the logger writes to the console.

- [#32](https://github.com/gabrielbarbosaa/nekolog-io/pull/32) [`b1b2af6`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b1b2af6a3323548280ae035d0b2c1a8d51cf05b5) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add the batching transport: queue, retry, `Retry-After` and `flush()`.
  
  A logger created with an `apiKey` now sends. Events queue up and leave in
  batches, bounded by the contract's 500 events and 512 KB; a batch too large is
  split in half until it fits, and an event that cannot fit alone is dropped and
  counted rather than lost in silence. The `batchId` is a dependency-free UUID v7
  and stays the same across retries, which is what lets the server deduplicate a
  resend.
  
  Retries are exponential with jitter and honour `Retry-After` exactly, in seconds
  or as an HTTP date. When the server asks for longer than the backoff ceiling, the
  transport pauses until that moment instead of blocking or coming back early.
  
  `invalid_key`, `origin_not_allowed`, `secret_key_in_url` and
  `unsupported_schema_version` stop the transport for good — hammering a bad key
  only costs noise. `invalid_payload` and `payload_too_large` drop that batch and
  carry on, and events rejected inside an accepted batch arrive on `onReject`.
  
  The API key always travels in the `Authorization` header and never in the URL.

- [#36](https://github.com/gabrielbarbosaa/nekolog-io/pull/36) [`d079114`](https://github.com/gabrielbarbosaa/nekolog-io/commit/d07911460be593d83d87543da3131d824585fa94) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Redact `key=value` pairs inside message, error and attribute text.
  
  Key matching used to apply only to attribute keys, so a secret that landed in
  the middle of a string instead of becoming an attribute went through untouched:
  `POST /login?token=abc123`, `{"password":"hunter2"}`, `authorization: Bearer x`.
  That is the most common way a secret leaks into a log by accident.
  
  The same key list drives both, so `privacy.extraKeys` and `privacy.skipKeys`
  apply here too. The value ends at the first space, comma, `;`, `&`, `)`, `}` or
  `]`, which keeps `?token=abc&user=ana` from swallowing the next parameter, and
  an auth scheme word (`Bearer`, `Basic`, `Token`, `Digest`) is taken with the
  credential rather than left behind.
  
  An innocent key never swallows the sensitive pair after it: in
  `callback failed: ?secret=zzz`, `failed:` does not consume `?secret=zzz` and let
  it through. The scan looks for `key<separator>` without reading the value, and
  only measures a value once the key is known to be sensitive — which is also
  what keeps the cost linear instead of quadratic.
  
  `redactText` takes the key matcher as a new optional third argument; without it
  it behaves exactly as before.

- [#183](https://github.com/gabrielbarbosaa/nekolog-io/pull/183) [`b8bf9ba`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b8bf9badfd7079c09966b87d8a5db172954c813c) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Make the ingestion fit the CPU budget it actually has.
  
  A Worker on the free plan gets ~10 ms of CPU per request. Measured on 2026-11-04
  (step 6.4), the biggest batch specification 1 allows — 500 events, 20% errors,
  gzipped, every redaction rule on — cost **10.8 ms**. It did not fit, and no test
  could see it, because k6 measures latency and the CPU limit hides behind network
  waits.
  
  Two changes came out of that.
  
  **The fingerprint is memoized per batch.** The 100 `crypto.subtle.digest` calls
  in that batch cost 1.2 ms, and in a burst — which is the shape an incident has —
  they are all the same error. `createFingerprinter()` keys a map on the exact text
  that gets hashed, so the same error is hashed once. The map lives for one batch
  and never globally: a long-lived isolate would otherwise keep one that only
  grows. The worst case, where every error is distinct, is unchanged.
  
  **The SDK's default batch is 200 events, not 500.** `DEFAULT_MAX_BATCH_EVENTS`
  is new in `@nekolog-io/core`; `MAX_EVENTS_PER_BATCH` is untouched, so the
  protocol limit and the server are the same as before and a caller can still ask
  for 500. What changed is that the default client no longer sends the worst case
  without anyone choosing it. 200 events cost about 2.1 ms.
  
  After both, the 500-event batch costs 9.1 ms. There is still no headroom at the
  maximum, deliberately: asking for 500 is asking for the limit.
  
  Redaction was **not** optimised, although it is the second biggest cost. Every
  plausible optimisation there is a heuristic that skips values, and a privacy
  control that quietly stops redacting is worse than one that over-redacts.
  
  `apps/ingest` gains `src/budget.test.ts`, which measures the worst legal batch
  and fails both on an absolute per-event ceiling and — machine-independently — if
  cost stops growing linearly with the batch.

- [#34](https://github.com/gabrielbarbosaa/nekolog-io/pull/34) [`5f26ab2`](https://github.com/gabrielbarbosaa/nekolog-io/commit/5f26ab2ff5fc117df13d1c0e949451c98c54733d) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add the privacy pipeline: sensitive-data removal, sampling and `beforeSend`.
  
  Every event now goes through sampling, then `beforeSend`, then redaction.
  Redaction is on by default and runs last, so a `beforeSend` hook cannot put
  back what the SDK just took out. It matches sensitive attribute keys on any
  segment of the flattened path, and finds card numbers (Luhn-checked), CPFs
  (check digits), JWTs, `Bearer`/`Basic` credentials, credentials inside URLs and
  NekoLog keys inside message, error and attribute text.
  
  Sampling is consistent per trace, so a request is never recorded half way, and
  `error`/`fatal` are never sampled away unless `sampling.alwaysFrom` is set to
  `false`.
  
  Whatever `beforeSend` returns is revalidated against the ingestion contract, so
  a hook cannot produce an event the API would reject.

- [#148](https://github.com/gabrielbarbosaa/nekolog-io/pull/148) [`6a43ea9`](https://github.com/gabrielbarbosaa/nekolog-io/commit/6a43ea95c5d0d4b371f0caf83cf6af0cef906631) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Propagate W3C `traceparent`, and only to the domains that were configured. The parsing and formatting now live in `@nekolog-io/core` — `parseTraceparent`, `traceparentOf`, `traceForRequest`, `childSpan` and `createTraceTargetMatcher` — so the browser, Node and the Express example stop carrying three copies of the same spec. In the browser every log on the page carries the same trace and every request gets a child span, which is what puts a click on the front end and the request on the back end in one timeline; the default target is the page's own origin, because a `traceId` is an internal identifier and an extra header on a cross-origin request turns it into a preflight that can simply fail. Matching is strict on purpose: whole-host or whole-origin equality, `.example.com` for subdomains, an optional path that must match a segment boundary, `http:`/`https:` only, and never the ingestion endpoint. In Node `installTracePropagation({targets})` reads the trace from the request's `AsyncLocalStorage` context and has **no default**: there is no "own origin" on a server, and silently sending internal trace ids to a payment gateway is not a default anybody wants. Adding the header never breaks the request — `Headers`, pair lists, plain objects and a prepared `Request` are each extended rather than replaced, and anything unexpected means the request goes out without the header instead of not going out.

### Patch Changes

- [#145](https://github.com/gabrielbarbosaa/nekolog-io/pull/145) [`819d6fc`](https://github.com/gabrielbarbosaa/nekolog-io/commit/819d6fcbaefe135ff7e777ed5f7b6d84ac664120) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add `@nekolog-io/browser`: uncaught errors and rejected promises, a per-tab session, `setUser`, and the batch leaving by `sendBeacon` on `pagehide`. A secret key handed to a browser is refused rather than sent, because anyone reading the page would have it. The beacon cannot carry a header, which is the whole reason the public key travels in the URL on that one path and the body goes as `text/plain` — a JSON content type would ask for a preflight that never happens while the page is unloading. `page.url` drops the query string and the fragment by default, because that is where reset tokens and coupons live. The session is a UUID in `sessionStorage` that only comes back if it still looks like one, so a poisoned entry becomes a new session instead of an attribute. `TransportTuning` gained a `fetch`, which is the seam the browser transport sends through.

- [#126](https://github.com/gabrielbarbosaa/nekolog-io/pull/126) [`7cf3601`](https://github.com/gabrielbarbosaa/nekolog-io/commit/7cf36016f14662a672e3db55b1eed10d6310d4d2) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Fuzz the ingestion validator, the body reader and the SDK-to-ingest contract with fast-check, and pin the limits of specification 1 to their documented values instead of only to each other.
