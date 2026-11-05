---
title: Fastify
description: One plugin, three hooks, and the CORS header the browser needs.
---

```bash
npm install @nekolog-io/fastify @nekolog-io/node
```

```ts
import Fastify from 'fastify'
import { createLogger, installProcessHooks } from '@nekolog-io/node'
import { nekologPlugin } from '@nekolog-io/fastify'

const log = createLogger({ service: 'checkout-api' })
installProcessHooks(log)

const app = Fastify()
await app.register(nekologPlugin, { logger: log })

app.get('/orders/:id', async (request) => {
  log.info('Order read', { orderId: request.params.id })
  return { ok: true }
})
```

Three hooks: `onRequest` opens the context and answers with `traceparent` and
`x-request-id`, `onResponse` writes the access line, `onError` logs what the
handler threw.

| Option | |
|---|---|
| `logger` | the logger, required |
| `accessLog: false` | keep the context and the error log, drop the line per response |
| `newRequestId` | your own id generator |

## The plugin is deliberately not encapsulated

It carries `Symbol.for('skip-override')`. Without it, Fastify would encapsulate
the hooks inside the `register` scope and nothing outside it would be logged —
which is the opposite of what a logging plugin is for.

Register it once, at the root. You do not need it inside each plugin of your
app.

## The context crosses `done()`

`onRequest` calls `done()` **inside** `runWithContext`. That is how
`AsyncLocalStorage` follows the rest of the request's lifecycle; calling
`done()` from outside would run the handler with no context, and the request id
would vanish from everything it logged. There is a test with three concurrent
requests checking the ids do not mix.

## The route is the pattern

`request.routeOptions.url` on Fastify 4+, with `request.routerPath` as the
fallback for older versions. Neither present means `unmatched`.

## A header that arrived twice

Node hands over an array when the same header comes more than once. The plugin
takes the first and ignores anything that is not text — a numeric
`x-request-id` is not turned into a string for convenience.

## Allowing `traceparent` through CORS

A browser on another origin sending `traceparent` (which
[the browser SDK](/docs/guides/browser/) does for the targets you configure)
triggers a CORS preflight for that custom header. Allow it:

```ts
import cors from '@fastify/cors'

await app.register(cors, {
  origin: 'https://shop.test',
  allowedHeaders: ['content-type', 'authorization', 'traceparent'],
  exposedHeaders: ['traceparent', 'x-request-id'],
})
```

`allowedHeaders` lets the header come **in**; `exposedHeaders` lets the page
read the `traceparent` and `x-request-id` that come back. See
[Distributed tracing](/docs/guides/tracing/).
