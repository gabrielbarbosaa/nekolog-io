---
title: Node.js
description: Per-request context, process hooks, and the environment variables the SDK reads.
---

```bash
npm install @nekolog-io/node
```

```ts
import { createLogger, installProcessHooks } from '@nekolog-io/node'

const log = createLogger({ service: 'checkout-api', release: '1.4.2' })
installProcessHooks(log)

log.info('Order created', { orderId: 123 })
await log.flush()
```

This is the package every server integration sits on —
[Express](/docs/guides/express/), [Fastify](/docs/guides/fastify/),
[Hono](/docs/guides/hono/), [NestJS](/docs/guides/nestjs/) and the server half
of [Next.js](/docs/guides/next/) all use it.

## Environment variables

With no explicit option, these apply:

| Variable | For |
|---|---|
| `NEKOLOG_KEY` | the key; it already determines project and environment |
| `NEKOLOG_ENDPOINT` | another destination, if yours is not the default one |
| `NEKOLOG_SERVICE` | the service name |
| `NEKOLOG_RELEASE` | the deployed version |
| `NEKOLOG_LEVEL` | the minimum level |

What you pass in code beats the variable. A blank variable is treated as
absent, not as an empty string, and a `NEKOLOG_LEVEL` that does not exist is
**ignored and reported** through `onError` instead of taking the logger down.

## Per-request context

`runWithContext` pins a context to the whole asynchronous branch. The logger
reads that context **on every call**, so it does not have to be recreated per
request, nor passed around:

```ts
runWithContext({ attributes: { requestId }, trace }, async () => {
  await handle()
})
```

| | |
|---|---|
| `runWithContext(ctx, fn)` | runs `fn` with `ctx` added to whatever already applied |
| `addContext(ctx)` | adds to the scope already running; returns `false` if there is none |
| `bindContext(ctx, fn)` | returns `fn` with the context attached, for a callback that runs later |
| `currentContext()` | the context in force right now, or `undefined` |

Nested scopes **add up**, and the inner one wins on a repeated key. What you
pass at the call site (`log.child(...)` or the second argument) beats the
ambient context — ambient is background, not an order.

`addContext` only reaches the current scope and the ones born from it. It does
**not** travel back out: discovering the `userId` in the middle of a request
should not leak into the next one.

Concurrent requests do not mix, and there is a test with three deliberately
interleaved requests.

### A listener does not inherit the context

An event listener runs under whatever context is active when the event is
emitted — for a backpressured response, that is the socket's, not the
request's. Wrap it:

```ts
response.on('finish', bindContext(currentContext(), write))
```

## Process hooks

Creating the logger does not touch `process`. This call does, explicitly —
changing how a process exits behind the back of whoever installed the package is
how you get a zombie service in production.

```ts
const uninstall = installProcessHooks(log, {
  signals: ['SIGTERM'],
  flushTimeoutMs: 5000,
})
```

| Event | What happens |
|---|---|
| `uncaughtException` | writes the error to stderr, logs it as `fatal`, flushes, **and then exits with 1** |
| `unhandledRejection` | the same |
| `SIGTERM`, `SIGINT` | flushes, then lets the signal do what it was going to do |
| `beforeExit` | flushes once, and gets out of the way |

Three things worth more than the table:

- **Node's default behaviour is preserved.** Installing an `uncaughtException`
  listener stops Node from killing the process — that is how a service becomes a
  zombie holding connections. So the stack still goes to stderr, and the process
  still exits with 1. `exitOnFatal: false` turns that off, if you really want it.
- **If the app already handles it, the SDK does not decide.** With another
  `uncaughtException` listener registered, we do not exit — whoever registered it
  has a plan. With another `SIGTERM` listener (a graceful shutdown), we flush and
  step aside.
- **The flush has a deadline.** `flushTimeoutMs` (2 s by default) stops a stuck
  network from holding the shutdown forever. A failing network must not become a
  stuck deploy.

## Serverless

`await log.flush()` before returning the response is **mandatory** where the
process can be frozen or killed right after the handler returns.

## Outgoing requests

`installTracePropagation({ targets })` adds the W3C `traceparent` header to the
calls your service makes. `targets` is required and there is no default — see
[Distributed tracing](/docs/guides/tracing/).
