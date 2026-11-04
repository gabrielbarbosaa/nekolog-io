---
title: Hono
description: One middleware, any runtime, and the CORS header the browser needs.
---

:::caution[Not on npm yet]
The `@nekolog-io/*` packages have not been published. This page describes the
behaviour the code already has, so the shape of the API is clear.
:::

```bash
npm install @nekolog-io/hono @nekolog-io/node
```

```ts
import { Hono } from 'hono'
import { createLogger } from '@nekolog-io/node'
import { nekolog } from '@nekolog-io/hono'

const log = createLogger({ service: 'checkout-api' })

const app = new Hono()
app.use('*', nekolog(log))

app.get('/orders/:id', (c) => {
  log.info('Order read', { orderId: c.req.param('id') })
  return c.json({ ok: true })
})
```

One middleware does all three jobs — context, access line, error — because in
Hono everything happens around the same `await next()`.

| Option | |
|---|---|
| `accessLog: false` | keep the context, drop the line per response |
| `newRequestId` | your own id generator |

## The line is written even when `next()` rejects

`record()` lives in a `finally`. If a middleware further down throws, the
request still gets its access line — and the error **keeps going up**, it is not
swallowed.

Hono handles handler errors internally and answers 500, so this path does not
show up in a test through `app.request()`. There is a test calling the
middleware directly with a rejecting `next`, which is the only way to see it.

## The route is the pattern

`c.req.routePath` when it exists, and the path when Hono matched `/*` —
otherwise every unmatched request would collapse into the same route. Nothing
matched at all becomes `unmatched`.

## Runtimes

The middleware depends on `@nekolog-io/node`, which uses `AsyncLocalStorage`
from `node:async_hooks`. That exists on Node, Bun, Deno and Cloudflare Workers
(with `nodejs_compat`). It does not exist in a browser, but a server middleware
does not run there.

On Workers, remember that the isolate can be frozen as soon as the response is
returned. Flush before you answer, or hand the promise to `waitUntil`:

```ts
app.use('*', async (c, next) => {
  await next()
  c.executionCtx.waitUntil(log.flush())
})
```

## Allowing `traceparent` through CORS

A browser on another origin sending `traceparent` (which
[the browser SDK](/docs/guides/browser/) does for the targets you configure)
triggers a CORS preflight for that custom header. Allow it:

```ts
import { cors } from 'hono/cors'

app.use(
  '*',
  cors({
    origin: 'https://shop.test',
    allowHeaders: ['content-type', 'authorization', 'traceparent'],
    exposeHeaders: ['traceparent', 'x-request-id'],
  }),
)
```

`allowHeaders` lets the header come **in**; `exposeHeaders` lets the page read
the `traceparent` and `x-request-id` that come back. See
[Distributed tracing](/docs/guides/tracing/).
