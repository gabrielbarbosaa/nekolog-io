---
title: Quickstart
description: Send your first log from a Node.js application.
---

:::caution[You need an invitation first]
The `@nekolog-io/*` packages are not public. Your invitation carries the
registry credentials and the keys for your first project; set them up before
the commands below will work.
:::

## Install

```bash
npm install @nekolog-io/node
```

## Send a log

```ts
import { createLogger } from '@nekolog-io/node'

const log = createLogger({
  apiKey: process.env.NEKOLOG_KEY!, // the key already identifies project + environment
  service: 'checkout-api',
  release: '1.4.2',
})

log.info('Order created', { orderId: 123 })
log.child({ requestId }).error(err, { step: 'payment' })

await log.flush() // important in serverless, where the process can exit early
```

## What to expect

- Logs are sent in batches, gzipped, with retry and backoff. A failed send never
  throws into your application.
- `flush()` waits for everything queued to be delivered. Call it before a
  serverless function returns, or on shutdown.
- Sensitive fields (`password`, `token`, `authorization`, `cpf`, card numbers)
  are stripped by default, before anything leaves your process.

## Next steps

- [`nekolog init`](/docs/guides/cli/) — one command that detects the framework,
  installs the right SDK and writes the `.env`.
- [Bundler plugin](/docs/guides/bundler-plugin/) — record the release and upload
  the source maps from inside your Vite, webpack, Rollup or esbuild build.
- The guide for your stack: [Browser](/docs/guides/browser/),
  [React](/docs/guides/react/), [Next.js](/docs/guides/next/),
  [Node.js](/docs/guides/node/), [Express](/docs/guides/express/),
  [Fastify](/docs/guides/fastify/), [Hono](/docs/guides/hono/),
  [NestJS](/docs/guides/nestjs/), [pino](/docs/guides/pino/) or
  [winston](/docs/guides/winston/).
- [Distributed tracing](/docs/guides/tracing/) — one timeline across the
  front-end and the back-end, and the CORS header it needs.
- [Alerts](/docs/guides/alerts/) — the five kinds of rule, and how to verify a
  webhook really came from NekoLog.
- [The public API](/docs/api/reference/) and its
  [search language](/docs/api/search/) — read everything the dashboard shows,
  yourself. Already on OpenTelemetry? There is an
  [OTLP endpoint](/docs/api/otlp/).
- [What is stored](/docs/reference/privacy/) — what never leaves your process,
  what the server removes, and what is never written at all.
- [Versioning and support](/docs/reference/versioning/) — what a change
  promises, and how long an old version keeps working.
- [Introduction](/docs/getting-started/introduction/) — how the pieces fit
  together and what you get.
