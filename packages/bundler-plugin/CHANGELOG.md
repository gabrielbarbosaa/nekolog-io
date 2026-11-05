# @nekolog-io/bundler-plugin

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

- [#182](https://github.com/gabrielbarbosaa/nekolog-io/pull/182) [`30fe40f`](https://github.com/gabrielbarbosaa/nekolog-io/commit/30fe40f0a87a4f64ab8b5186f8080dce1cff8074) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Record the release and upload the source maps from inside the build.
  
  `@nekolog-io/bundler-plugin` is an `unplugin`, with one entry per bundler —
  `/vite`, `/webpack`, `/rollup`, `/esbuild` — that calls the two operations the
  CLI already exposes, at `writeBundle`. The maps that go up are the ones the
  build just wrote, and nobody has to remember a deploy step.
  
  Two rules decide everything. With **no key** it does nothing and says so in one
  line, because that is what a local build looks like. With a key, **anything
  else wrong fails the build**: a public key, a missing release, a mistyped
  commit, plain HTTP to anywhere but this machine, a map the API refused. A
  release recorded without its maps is the exact problem the feature exists to
  prevent.
  
  It has no `transform`, no `load` and no `resolveId` — only `writeBundle` — so
  it has no way to write the secret key into the bundle it is uploading maps for,
  and a test fails if one of those hooks ever appears. In Vite it is
  `apply: 'build'`, so the dev server never uploads. Nothing is validated while
  the config is read, so a wrong key cannot stop `vite dev` from starting. It
  uploads once per process, however many times the bundler writes.
  
  The output directory is learned from the bundler itself (`build.outDir`,
  `output.path`, `outdir`/`outfile`, `dir`/`file`), with an explicit `dir`
  winning and `dist` as the fallback. A commit passed by hand must be valid; one
  merely found in `GITHUB_SHA`, `VERCEL_GIT_COMMIT_SHA` or `CI_COMMIT_SHA` is
  best effort, so a branch ref in that variable records a release with no commit
  instead of breaking a deploy.
  
  `deleteAfterUpload` is off by default and, when on, removes only the files
  whose name the API confirmed — a map the upload skipped stays on disk, because
  nobody else has a copy.
  
  The CLI now exports `reasonFrom`, which the two commands had a copy of each.

### Patch Changes

- Updated dependencies [[`645d187`](https://github.com/gabrielbarbosaa/nekolog-io/commit/645d1876a94ec46fa639d78116635272c471608d), [`30fe40f`](https://github.com/gabrielbarbosaa/nekolog-io/commit/30fe40f0a87a4f64ab8b5186f8080dce1cff8074), [`c95a2d5`](https://github.com/gabrielbarbosaa/nekolog-io/commit/c95a2d5b337048cadacb049d243bdb4bf04594f2), [`d6029f2`](https://github.com/gabrielbarbosaa/nekolog-io/commit/d6029f290ed1faf4151d9356ba87c77b148710bc)]:
  - @nekolog-io/cli@1.0.0
