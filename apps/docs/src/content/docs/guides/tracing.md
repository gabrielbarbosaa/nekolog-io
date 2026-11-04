---
title: Distributed tracing
description: Connect a click in the browser to the request it caused — and the CORS header that makes it possible.
---

:::caution[Not on npm yet]
The `@nekolog-io/*` packages have not been published. This page describes the
behaviour the code already has, so the shape of the API is clear.
:::

Every log from a page carries the same `trace`, and every request leaves with a
W3C `traceparent` header — a child span per request. The back-end continues that
trace instead of starting a new one, and a click on the front-end and the
request on the back-end end up on the same timeline.

```
00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
   └ version        └ trace id              └ span id    └ flags
```

## In the browser

```ts
init({ trace: { targets: ['api.shop.test', '.services.internal'] } })
init({ trace: { sameOrigin: false, targets: [/^https:\/\/api\./] } })
init({ trace: false })
```

**By default, only the page's own origin.** A `traceId` is an internal
identifier: sending it to a third party is a small leak for nothing, and an
extra header on a cross-origin request turns it into a preflight that can simply
break the call. The ingestion endpoint is skipped too — it has nothing to do
with it.

## The matcher is strict on purpose

| Entry | Matches |
|---|---|
| `api.shop.test` | that host only |
| `.shop.test` | the domain and its subdomains |
| `shop.test/api` or `https://shop.test/api` | that host, on that path or below it |
| `/^https:\/\/api\./` | whatever the expression says |

A host that merely **starts** the same (`api.shop.test.evil.test`) does not
match: the comparison is whole origin and whole host, never a text prefix. A
different port is a different origin. `http:` is not `https:`. A path entry has
to match at a segment boundary. Any scheme other than `http`/`https` never gets
the header.

Adding the header never breaks the request. `Headers`, pair lists, plain objects
and a prepared `Request` are each extended, not replaced — and if anything goes
wrong while building it, the request goes out **without** the header rather than
not going out.

## On the server

Each middleware ([Express](/docs/guides/express/),
[Fastify](/docs/guides/fastify/), [Hono](/docs/guides/hono/),
[NestJS](/docs/guides/nestjs/)) already reads the incoming `traceparent`,
continues the trace with a new span, pins it to the request context, and answers
with `traceparent` and `x-request-id`. An invalid `traceparent` does not break
the request: it becomes a new trace.

For the calls your service **makes**:

```ts
import { installTracePropagation } from '@nekolog-io/node'

installTracePropagation({ targets: ['orders.internal', '.services.internal'] })
```

`targets` is **required, and there is no default**. In a browser "its own
origin" is an obvious safe default; on a server there is no own origin, and
quietly sending an internal trace id to a payment gateway is not what anyone
wanted. If you do not list it, nothing is propagated — which is better than
propagating to everybody in silence.

The trace comes from the request's context, and each call carries a child span,
never the request's own span. Outside a request there is no trace, so no header
goes out.

## CORS: the part that bites

`traceparent` is not a CORS-safelisted header. The moment the browser adds it to
a **cross-origin** request, that request stops being simple and gets a preflight
— and if your API does not answer the preflight allowing the header, the call
fails before your handler ever sees it.

Two headers matter, and they do different jobs:

| Response header | What it buys |
|---|---|
| `Access-Control-Allow-Headers: traceparent` | lets the request carry the header **in**. Without it, the call fails |
| `Access-Control-Expose-Headers: traceparent, x-request-id` | lets the page **read** what came back. Without it, the call works and the values are just invisible to JavaScript |

Only the first one is required. The second is what lets you show a request id on
an error screen so someone can paste it into a support ticket.

```http
Access-Control-Allow-Origin: https://shop.test
Access-Control-Allow-Headers: content-type, authorization, traceparent
Access-Control-Expose-Headers: traceparent, x-request-id
```

Each server guide has the snippet for its framework:
[Express](/docs/guides/express/), [Fastify](/docs/guides/fastify/),
[Hono](/docs/guides/hono/), [NestJS](/docs/guides/nestjs/),
[Next.js](/docs/guides/next/).

### If you cannot change the API

Leave that host out of `targets`. The page keeps its own trace, the request goes
out untouched, and the only thing you lose is the link between the two sides for
that call. That is a better trade than a broken checkout.

## Sampling does not cut a request in half

If sampling is on and the context carries a `trace.traceId`, the decision comes
from a hash of the trace, not from a per-event draw: either every log of that
request is in, or none is. Half a request in the dashboard helps nobody debug
anything. Errors are never dropped by sampling — the floor starts at `error`.
