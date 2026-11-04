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

## After it runs

Open the guide for what it installed: [Browser](/docs/guides/browser/),
[React](/docs/guides/react/), [Next.js](/docs/guides/next/),
[Node.js](/docs/guides/node/), [Express](/docs/guides/express/),
[Fastify](/docs/guides/fastify/), [Hono](/docs/guides/hono/) or
[NestJS](/docs/guides/nestjs/).
