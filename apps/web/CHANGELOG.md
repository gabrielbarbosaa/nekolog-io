# @apps/web

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

- [#140](https://github.com/gabrielbarbosaa/nekolog-io/pull/140) [`57b4917`](https://github.com/gabrielbarbosaa/nekolog-io/commit/57b49176b3ce79c62fe02aeee9b316f2a5c8f6c0) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Publish the terms of use and the privacy policy at `/legal/terms` and `/legal/privacy`, in English, Portuguese and Spanish, linked from the home page. The documents are typed data rather than markup, so a parity test can fail when a translation drops a clause, lags behind on the date, leaves an entry blank or still carries the English sentence. The policy says plainly what is deliberately never stored — the IP address, the password, the API key — and who the data is processed with.

- [#143](https://github.com/gabrielbarbosaa/nekolog-io/pull/143) [`bf7a4e4`](https://github.com/gabrielbarbosaa/nekolog-io/commit/bf7a4e49626955b495e103d7874e3ea6db9b4689) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Watch the two things that fill up in silence, and tell an external monitor the jobs are alive. `capacity-watch` counts what is still parked in the R2 spool and reads `system.disks` every five minutes, alerting above 100 pending files or below 15% free — and alerting when it cannot read either one, because an unreadable spool is the state in which the platform is worst, not best. The scheduled run then pings `HEARTBEAT_URL` on success and `…/fail` on failure, so a dead cron and a broken task do not look the same to the monitor; a monitor that is down is logged and never fails the run. `apps/web` answers `/health` with its version.

- [#139](https://github.com/gabrielbarbosaa/nekolog-io/pull/139) [`51a02a4`](https://github.com/gabrielbarbosaa/nekolog-io/commit/51a02a4516c9ec5ed761437c654ba1a12a14e923) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Serve both sites with the security headers of plan §14: CSP with a per-response nonce on the landing page and a per-script hash on the static docs, HSTS with preload, `frame-ancestors 'none'`, `Referrer-Policy`, `Permissions-Policy` and `X-Content-Type-Options`. `script-src` carries neither `'unsafe-inline'` nor `'unsafe-eval'` on either side. The tests start the real production server and fail if any `<script>` in the page lacks the nonce, or if the committed `vercel.json` stops covering an inline script the build produced — a script the policy would block is a blank page, not a warning.

### Patch Changes

- [#141](https://github.com/gabrielbarbosaa/nekolog-io/pull/141) [`9b3c189`](https://github.com/gabrielbarbosaa/nekolog-io/commit/9b3c189d6d2b6214cbb8e56133cc85a66f837181) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Serve `/docs` from the documentation project instead of from the site, and keep the site's proxy out of that path. The documentation is static and carries a hash-based policy of its own; letting the site's nonce policy overwrite it would block every Starlight script and leave a blank page with no build error. The guard reads the compiled matcher out of `functions-config-manifest.json` and fails if the proxy was built to run on a `/docs` path — an assertion against the running server could not tell the two configurations apart while the rewrite has nowhere to go.
- Updated dependencies [[`51a02a4`](https://github.com/gabrielbarbosaa/nekolog-io/commit/51a02a4516c9ec5ed761437c654ba1a12a14e923)]:
  - @internal/security-headers@0.1.0
