# @apps/docs

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

- [#139](https://github.com/gabrielbarbosaa/nekolog-io/pull/139) [`51a02a4`](https://github.com/gabrielbarbosaa/nekolog-io/commit/51a02a4516c9ec5ed761437c654ba1a12a14e923) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Serve both sites with the security headers of plan §14: CSP with a per-response nonce on the landing page and a per-script hash on the static docs, HSTS with preload, `frame-ancestors 'none'`, `Referrer-Policy`, `Permissions-Policy` and `X-Content-Type-Options`. `script-src` carries neither `'unsafe-inline'` nor `'unsafe-eval'` on either side. The tests start the real production server and fail if any `<script>` in the page lacks the nonce, or if the committed `vercel.json` stops covering an inline script the build produced — a script the policy would block is a blank page, not a warning.

- [#185](https://github.com/gabrielbarbosaa/nekolog-io/pull/185) [`2bad421`](https://github.com/gabrielbarbosaa/nekolog-io/commit/2bad421e07d3091ab342fd54259eba6af1f7ca36) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Document what shipped: the public API, the search language, OTLP, alerts,
  privacy and versioning — in all three languages.
  
  Six pages were missing for things that exist and work. The public read API had
  no reference at all, so the only way to learn its routes was to read the
  OpenAPI it serves. The **search language** was referenced by the quickstart, the
  guides and the self-host page and documented nowhere. The **OTLP endpoint** had
  shipped with no page, so nobody would know it was there. **Alerts** had five
  rule types, a webhook signature and an SSRF guard, none of it written down.
  
  The other two are the ones a user has to be able to find before trusting a
  logging platform with their data: **what is stored** — the IP that is never
  written, what the SDK removes before it leaves the process, what the server
  removes again, and how retention is enforced by the server's clock rather than
  the client's — and **versioning and support**, which is what a change to any of
  this promises and how long an old version keeps working.
  
  `apps/api/src/documented.test.ts` reads those pages in all three languages and
  fails if they drift from the code: every error code with its status, every
  parameter each route takes, every histogram bucket, every search field, and the
  limits — 1000 rows, 200 issues, 1500 points, 120 requests a minute, 31 days,
  8 MB, 200 maps, and the three the search language sets. A number in the
  documentation is now pinned to the constant that enforces it.

### Patch Changes

- Updated dependencies [[`51a02a4`](https://github.com/gabrielbarbosaa/nekolog-io/commit/51a02a4516c9ec5ed761437c654ba1a12a14e923)]:
  - @internal/security-headers@0.1.0
