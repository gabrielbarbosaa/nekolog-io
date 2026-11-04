---
title: React
description: Provider, useLogger and an error boundary that reports what broke.
---

:::caution[Not on npm yet]
The `@nekolog-io/*` packages have not been published. This page describes the
behaviour the code already has, so the shape of the API is clear.
:::

```bash
npm install @nekolog-io/react
```

```tsx
import { ErrorBoundary, NekologProvider, useLogger } from '@nekolog-io/react'

export function App() {
  return (
    <NekologProvider apiKey={import.meta.env.VITE_NEKOLOG_KEY} service="checkout-web">
      <ErrorBoundary name="checkout" fallback={<p>Something went wrong.</p>}>
        <Checkout />
      </ErrorBoundary>
    </NekologProvider>
  )
}

function Checkout() {
  const log = useLogger()
  log.info('Checkout opened', { step: 'payment' })
}
```

Everything in the [browser guide](/docs/guides/browser/) applies here —
sessions, breadcrumbs, the offline queue, `traceparent`, `setUser`, the flush on
`pagehide`. This package only adds what belongs to React.

## One SDK per page, not one per provider

`NekologProvider` does not create a client per mount: it takes the page's
client, which exists once. Two nested providers, StrictMode rendering
everything twice, a route that unmounts and remounts — all of them share one
client, with the global handlers installed once.

That is why unmounting the provider **closes nothing**. The page is still the
page, and the global error handlers and the `pagehide` flush still apply. To
really shut it down, call `closeClient()` — which is what the tests do between
one case and the next.

```tsx
<NekologProvider logger={myLogger}>…</NekologProvider>
```

With a `logger` prop the provider uses what you pass and creates no client at
all. That is the path for tests, and for an app that builds its logger
elsewhere.

## `useLogger` outside a provider does not take the app down

It returns a logger that writes to the console and **warns once** through
`onError`. React's convention would be to throw; this SDK's contract is to never
throw into the host application, and a forgotten provider cannot be the reason a
production page goes blank. The warning is loud enough.

## `ErrorBoundary`

| | |
|---|---|
| `fallback` | what to render instead — a node, or a function `({ error, reset })` |
| `name` | goes into the `react.boundary` attribute, so you know which part of the screen fell |
| `onError` | your own handler, which **always** runs, even when the logging fails |

The error becomes an `error` log with `react.component_stack` — the component
stack React hands over, cut at 2 000 characters so one stack cannot eat the
whole attribute budget. With no `fallback` it renders nothing, instead of
letting React tear the whole tree down.

```tsx
export default withErrorBoundary(Checkout, { fallback: <Oops /> })
```

## React Server Components

`useLogger` and `NekologProvider` are client components — they use context and
page state. In an app with Server Components, mark the file `'use client'`. For
the server side, use [`@nekolog-io/next`](/docs/guides/next/), which wires the
logger through `instrumentation.ts`.
