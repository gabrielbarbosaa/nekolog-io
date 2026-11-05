---
title: Next.js
description: register() on the server, the provider on the client, and the scope a route handler does not have.
---

```bash
npm install @nekolog-io/next
```

## The server

```ts
// instrumentation.ts
import { register as nekolog } from '@nekolog-io/next'

export function register() {
  nekolog({ service: 'shop' })
}

export { onRequestError } from '@nekolog-io/next'
```

`register()` runs once per process however many times Next calls
`instrumentation.ts` — two loggers would mean two sets of process hooks. On the
`nodejs` runtime it builds a [Node logger](/docs/guides/node/) with the
`uncaughtException`, `unhandledRejection` and `SIGTERM` hooks; on `edge` it
builds a core logger with `runtime: 'edge'` and **no** hooks, because there is no
`process` to hook into. A `NEXT_RUNTIME` that is neither is treated as
`nodejs` rather than believed.

## The client

```tsx
// app/providers.tsx
'use client'
import { NekologProvider } from '@nekolog-io/next/client'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NekologProvider apiKey={process.env.NEXT_PUBLIC_NEKOLOG_KEY}>{children}</NekologProvider>
  )
}
```

**Two entries, and that is load-bearing.** `@nekolog-io/next` is the server; it
pulls `node:async_hooks` through `@nekolog-io/node`, which breaks in a client
bundle. `@nekolog-io/next/client` is marked `'use client'` and imports nothing
from Node. Importing the wrong one fails immediately, which is better than
failing in production.

The public variable needs the **public** key. A `nekolog_sk_…` in a
`NEXT_PUBLIC_` variable ships in the bundle; the SDK refuses it, but the
credential is already published by then.

## `onRequestError`

Next hands server errors here. They become `error` logs with:

| Attribute | From |
|---|---|
| `http.path` | the path, **without the query string** |
| `http.method` | the method |
| `next.router` | `App Router` or `Pages Router` |
| `next.route` | the route with its brackets, `/checkout/[step]` |
| `next.render_source`, `next.revalidate_reason` | what Next reported |

**Headers never go in.** That is where the session cookie and the
`Authorization` live, and there is a test checking neither appears. If the
logger fails, the handler does **not** throw back into Next: the error being
handled matters more than ours.

## A route handler has no per-request context

Express, Fastify, Hono and Nest each have a middleware that opens the
`AsyncLocalStorage`. Next has no such hook — `instrumentation.ts` runs once per
process and `proxy.ts` runs in another runtime — so `addContext` in a route
handler has nowhere to write and the user id never shows up.

Open the scope yourself, in about ten lines:

```ts
// app/api/with-nekolog.ts
import {
  accessAttributes,
  accessMessage,
  levelForStatus,
  REQUEST_ID_HEADER,
  runWithContext,
  serverLogger,
  startRequest,
  TRACEPARENT_HEADER,
} from '@nekolog-io/next'

export function withNekolog(route: string, handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    const began = startRequest({
      traceparent: request.headers.get(TRACEPARENT_HEADER),
      requestId: request.headers.get(REQUEST_ID_HEADER),
    })
    const startedAt = Date.now()

    return runWithContext(began.context, async () => {
      const response = await handler(request)
      for (const [name, value] of Object.entries(began.headers)) {
        response.headers.set(name, value)
      }
      const line = {
        method: request.method,
        route,
        status: response.status,
        durationMs: Date.now() - startedAt,
      }
      serverLogger()?.log(levelForStatus(line.status), accessMessage(line), accessAttributes(line))
      return response
    })
  }
}
```

```ts
// app/api/orders/[id]/route.ts
import { addContext } from '@nekolog-io/next'
import { withNekolog } from '../../with-nekolog.ts'

export const GET = withNekolog('/api/orders/[id]', async (request) => {
  addContext({ attributes: { userId: 'u_42' } })
  return Response.json({ ok: true })
})
```

This lives in your app and not in the package because the right shape depends on
the app — what the route name is, whether you want the headers echoed back, what
you do on an error. `examples/next` in the repository has the whole file.

## Allowing `traceparent` through CORS

Only relevant if a browser on **another origin** calls these routes — a Next app
calling its own `/api` is same-origin and needs nothing. When it is
cross-origin, answer the preflight:

```ts
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': 'https://shop.test',
      'access-control-allow-headers': 'content-type, authorization, traceparent',
      'access-control-expose-headers': 'traceparent, x-request-id',
    },
  })
}
```

See [Distributed tracing](/docs/guides/tracing/).

## The rest

Per-request context, `traceparent` and the process hooks come from
[`@nekolog-io/node`](/docs/guides/node/); the provider, `useLogger` and the
error boundary come from [`@nekolog-io/react`](/docs/guides/react/). This
package only joins the two in the shape Next expects.
