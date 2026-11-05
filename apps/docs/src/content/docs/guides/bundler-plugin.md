---
title: Bundler plugin
description: Record the release and upload the source maps at the end of every production build, on Vite, webpack, Rollup or esbuild.
---

`@nekolog-io/bundler-plugin` does from inside the build what
[`nekolog releases create` and `nekolog sourcemaps upload`](/docs/guides/cli/)
do from a deploy script — so nobody has to remember to run them, and the maps
that go up are exactly the ones the build just wrote.

```ts
import nekolog from '@nekolog-io/bundler-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), nekolog()],
  build: { sourcemap: true },
})
```

There is one entry point per bundler, and all of them are the same plugin —
it is [`unplugin`](https://unplugin.unjs.io/) underneath:

```ts
import nekolog from '@nekolog-io/bundler-plugin/vite'
import nekolog from '@nekolog-io/bundler-plugin/webpack'
import nekolog from '@nekolog-io/bundler-plugin/rollup'
import nekolog from '@nekolog-io/bundler-plugin/esbuild'
```

Your bundler has to be writing source maps in the first place — `sourcemap:
true` in Vite and Rollup, `devtool: 'source-map'` in webpack, `sourcemap: true`
in esbuild. The plugin uploads what it finds; it does not turn map generation
on for you.

## Configuration

Everything can come from the environment, which is what a CI job already has.

| Option | Environment | |
|---|---|---|
| `key` | `NEKOLOG_KEY` | the **secret** key of the environment |
| `release` | `NEKOLOG_RELEASE` | the version going out |
| `commit` | `NEKOLOG_COMMIT`, `GITHUB_SHA`, `VERCEL_GIT_COMMIT_SHA`, `CI_COMMIT_SHA` | 7 to 40 lowercase hex characters |
| `apiUrl` | `NEKOLOG_API_URL` | where the public API answers |
| `dir` | — | what to walk, when the bundler does not say |
| `deleteAfterUpload` | — | remove the uploaded maps from the build (default: no) |
| `disable`, `silent` | — | turn it off, or keep it quiet |

A commit you pass yourself has to be right, and the plugin fails the build if it
is not. A commit it merely *found* in one of those CI variables is best effort:
if `GITHUB_SHA` happens to hold a branch ref, the release is recorded without a
commit instead of breaking your deploy.

## Two rules decide everything

**With no key it does nothing, and says so in one line.** That is what a local
build looks like — nobody has a secret key on their laptop, and a build that
failed over it would be unbearable.

**Once it has a key, anything else wrong fails the build.** A public key, a
missing version, a mistyped commit, plain `http://` to somewhere other than this
machine, a map the API refused — all of those are errors, not warnings. A
release recorded *without* its maps is exactly the problem this plugin exists to
prevent, and finding out from a minified stack trace in production is far too
late.

## What it never does

**It never touches your code.** The plugin has no `transform`, no `load` and no
`resolveId` — only `writeBundle`. It has no way to write the secret key into the
bundle it is uploading maps for, and a test fails if those hooks ever appear.

**It never runs on the dev server.** In Vite it is `apply: 'build'`, or every
reload would become an upload.

**It never throws while the config is being read.** Nothing is validated when
the plugin is constructed, only at the end of the build, so a wrong key in your
`.env` cannot stop `vite dev` from starting.

**It never uploads twice.** In watch mode, or in a build that writes more than
once, it uploads once per process.

**It never deletes a map that did not go up.** With `deleteAfterUpload` it
removes only the files whose name the API confirmed — a map over the size limit,
which the upload skipped, stays where it is, because nobody else has a copy.

## Where it looks for the maps

It learns the directory from the bundler itself: `build.outDir` in Vite,
`output.path` in webpack, `outdir` or `outfile` in esbuild, `dir` or `file` in
Rollup. An explicit `dir` beats all of them; with none of the above, `dist`.

It does **not** strip the `//# sourceMappingURL=` comment from the generated
files, not even with `deleteAfterUpload`. Doing that would mean rewriting the
build output, and the price of leaving it is a 404 in devtools for whoever opens
the file — not an error.

## In a CommonJS webpack config

The package is ESM. In a `webpack.config.js` that is still CommonJS, an async
config resolves it:

```js
module.exports = async () => ({
  devtool: 'source-map',
  plugins: [(await import('@nekolog-io/bundler-plugin/webpack')).default()],
})
```

## Next

The [CLI guide](/docs/guides/cli/) covers the same two operations as commands,
which is what you want when the build and the deploy are different jobs.
