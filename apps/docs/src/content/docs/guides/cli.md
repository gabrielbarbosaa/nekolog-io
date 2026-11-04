---
title: nekolog init
description: One command that detects the framework, installs the right SDK and writes the .env.
---

:::caution[Not on npm yet]
The `@nekolog-io/*` packages have not been published. This page describes the
behaviour the code already has, so the shape of the API is clear.
:::

```bash
npx @nekolog-io/cli init
npx @nekolog-io/cli init --key nekolog_pk_… --no-install
```

It reads the project's `package.json`, picks the SDK, installs it with whichever
package manager the lockfile names, and writes the environment variables.

| | |
|---|---|
| `--key <key>` | the key to write, `nekolog_pk_…` or `nekolog_sk_…` |
| `--no-install` | write the `.env` and **print** the install command instead of running it |
| `--cwd <path>` | where the project is |
| `--env <file>` | which file to write (default `.env`) |

## What it picks, and why

The order matters, because a real project has several of these at once:

| Found | Installs |
|---|---|
| `next` | `@nekolog-io/next` |
| `@nestjs/core` | `@nekolog-io/nestjs` |
| `fastify` / `hono` / `express` | the framework package plus `@nekolog-io/node` |
| `react` | `@nekolog-io/react` |
| `vite` without react | `@nekolog-io/browser` |
| none of those | `@nekolog-io/node` |

`next` beats `react` and `@nestjs/core` beats `express`, because in both cases
the outer one is in charge. It always prints **why** it chose.

The package manager comes from the lockfile — `pnpm-lock.yaml`, `bun.lock`,
`yarn.lock`, `package-lock.json`. With no lockfile, `npm`.

## Four things it refuses

**It never overwrites a variable the `.env` already holds.** If `NEKOLOG_KEY` is
already there it is left alone and the command says so. Your real key is not
replaced by a placeholder — nor by the one you just passed to `--key`.

**It never writes a secret key into a public variable.** In a Next project it
asks for both: `NEKOLOG_KEY` for the server and `NEXT_PUBLIC_NEKOLOG_KEY` for
the browser. A `--key nekolog_sk_…` fills only the first; the public one keeps
its placeholder, because a secret key in a `NEXT_PUBLIC_` variable goes straight
into the bundle.

**It writes nothing when the key does not look like a key.** The check runs
*before* the first write, so a wrong `--key` leaves no half-written file behind.

**It runs nothing through a shell.** The package manager is started with an
argument list and `shell: false`.

It also refuses a folder with no `package.json` rather than inventing a project.
If the install fails, the `.env` **stays written** and the message says what is
left to run.

## Recording a release

```bash
npx @nekolog-io/cli releases create 1.4.2 --commit "$(git rev-parse HEAD)"
```

It reads the key from `--key` or from `NEKOLOG_KEY`, and the key already says
which project and environment the release belongs to — you never pass either.

| | |
|---|---|
| `--key <key>` | the **secret** key of the environment (default: `$NEKOLOG_KEY`) |
| `--commit <sha>` | 7 to 40 lowercase hex characters |
| `--at <moment>` | when it went out, ISO 8601 (default: now) |
| `--api <url>` | where the public API answers (default: `https://api.nekolog.io`) |

Put it at the end of your deploy job. It is **idempotent**: running it again for
the same version changes nothing, keeps the moment the version first went out
and never drops a commit it already knows, so a rerun of a pipeline is harmless
and the exit code still means what it says.

Three things it refuses **before it opens a socket**, so a mistake never puts
your key on the wire:

- **a public key**, because it ships in every browser bundle;
- **a commit that is not what `git rev-parse` prints** — uppercase, too short or
  not hexadecimal;
- **plain HTTP to anywhere but this machine.** A secret key in the clear is a
  secret key given away. Point `--api` at `https://…`, or put a reverse proxy
  with a certificate in front of your self-host. `http://localhost` is allowed,
  because nothing leaves the machine.

## Uploading source maps

```bash
npx @nekolog-io/cli sourcemaps upload 1.4.2 --dir dist
```

Record the release first — the upload refuses a version this environment has
never seen, so the count on the release stays true. Then this walks `--dir`,
takes every `.map` it finds, and posts each one. A nested path is flattened into
a single name (`assets/index.mjs.map` becomes `assets-index.mjs.map`), and
`node_modules` and dotted folders are skipped because they are not your build.

| | |
|---|---|
| `--key <key>` | the **secret** key of the environment (default: `$NEKOLOG_KEY`) |
| `--dir <path>` | the build output to walk (default: `dist`) |
| `--api <url>` | where the public API answers |

Uploading the same name again replaces it and does not raise the count, so a
rerun is as harmless as rerunning `releases create`. A map over 8 MB is
**skipped and named**, not silently dropped, and an upload the server refuses
stops the whole run with the file name and the server's own reason.

:::note[Why the server does not parse your map]
It checks the shape — the first kilobytes must open a JSON object and name
`mappings` or `sections`, and a declared `version` must be 3 — and stores the
rest unread. Parsing megabytes of JSON does not fit the CPU budget of a Worker,
and the map is parsed where it is actually used.
:::

## After it runs

Open the guide for what it installed: [Browser](/docs/guides/browser/),
[React](/docs/guides/react/), [Next.js](/docs/guides/next/),
[Node.js](/docs/guides/node/), [Express](/docs/guides/express/),
[Fastify](/docs/guides/fastify/), [Hono](/docs/guides/hono/) or
[NestJS](/docs/guides/nestjs/).
