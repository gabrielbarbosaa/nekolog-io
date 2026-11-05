---
title: Express
description: Request context, one access line per response, and the CORS header the browser needs.
---

```bash
npm install @nekolog-io/express @nekolog-io/node
```

```ts
import express from 'express'
import { createLogger, installProcessHooks } from '@nekolog-io/node'
import { withAccessLog, withErrorLog, withLogContext } from '@nekolog-io/express'

const log = createLogger({ service: 'checkout-api' })
installProcessHooks(log)

const app = express()

app.use(withLogContext())
app.use(withAccessLog(log))

app.get('/orders/:id', (request, response) => {
  log.info('Order read', { orderId: request.params.id })
  response.json({ ok: true })
})

app.use(withErrorLog(log))
```

**The order matters.** `withLogContext` opens the scope, so it goes first;
`withErrorLog` is an error handler, so it goes after the routes.

| | |
|---|---|
| `withLogContext()` | reads `traceparent` and `x-request-id`, answers with both, pins the context to the request |
| `withAccessLog(log)` | one line per response, with method, route, status and duration |
| `withErrorLog(log)` | logs the error and **passes it on** — your handler is the one that responds |

## The route is the pattern, not the address

`GET /orders/:id 200`, never `GET /orders/ord_7f3a91 200`. Otherwise every id
becomes its own route and no chart groups anything. A request that matched no
route is logged as `unmatched`, not as the path.

## The incoming `x-request-id` is checked

Up to 64 characters of `[A-Za-z0-9._:-]`. Anything else — `\r\n`, a space,
`../`, a script tag — is discarded and a new id is minted. That value goes
straight back out in a response header, so trusting it would be letting the
client write one.

## `withErrorLog` does not respond

It logs and calls `next(error)`. Deciding the body and status of an error
response belongs to the app, not to a logging package — and if our logging
fails, the error **still** reaches the next handler.

## Allowing `traceparent` through CORS

If a browser on another origin sends `traceparent` (which
[the browser SDK](/docs/guides/browser/) does for the targets you configure),
the custom header triggers a CORS preflight. Your API has to allow it, or the
request fails before it starts:

```ts
import cors from 'cors'

app.use(
  cors({
    origin: 'https://shop.test',
    allowedHeaders: ['content-type', 'authorization', 'traceparent'],
    exposedHeaders: ['traceparent', 'x-request-id'],
  }),
)
```

`allowedHeaders` is what lets the request carry the header **in**;
`exposedHeaders` is what lets the page read the `traceparent` and
`x-request-id` that come back — handy when you want to show a request id in an
error screen. See [Distributed tracing](/docs/guides/tracing/).

## The `finish` listener is bound to the context

This is in the package, not something you write, but it is worth knowing why the
access line still carries what the route added with `addContext`: an event
listener does **not** inherit the `AsyncLocalStorage` of whoever registered it.
It runs under whatever context is active when the event is emitted, which for a
backpressured response is the socket's. So the `finish` listener is wrapped in
`bindContext`.
