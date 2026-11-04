---
"@nekolog-io/bundler-plugin": minor
"@nekolog-io/cli": patch
---

Record the release and upload the source maps from inside the build.

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
