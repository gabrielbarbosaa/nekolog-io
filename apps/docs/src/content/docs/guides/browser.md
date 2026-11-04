---
title: Browser
description: Install the browser SDK, catch uncaught errors, and keep user data out of your logs.
---

:::caution[Not on npm yet]
The `@nekolog-io/*` packages have not been published. This page describes the
behaviour the code already has, so the shape of the API is clear.
:::

```bash
npm install @nekolog-io/browser
```

```ts
import { init } from '@nekolog-io/browser'

const nekolog = init({
  apiKey: import.meta.env.VITE_NEKOLOG_KEY,
  service: 'checkout-web',
  release: '1.4.2',
})

nekolog.logger.info('Checkout opened', { step: 'payment' })
```

`init` does four things at once: it creates the logger, installs the two global
handlers, installs the breadcrumb collectors, and flushes the batch when the
page goes away. Each piece is also exported on its own (`createLogger`,
`installGlobalHandlers`, `installFlushOnHide`, `installBreadcrumbs`), and every
`install*` returns the function that undoes it.

## Use the public key

A `nekolog_sk_…` on a page is a published credential — anyone with "view
source" has it. The SDK **refuses** it, reports through `onError`, falls back to
the console, and sends nothing. It does not throw: taking down the application
of whoever misconfigured it is worse than not sending logs.

Use the environment's `nekolog_pk_…`. It identifies the project and the
environment, and it can only write.

## What you get without writing any code

| Event | Becomes |
|---|---|
| `error` on `window` | an `error` log with `error.kind=uncaught`, plus source, line and column |
| `unhandledrejection` | an `error` log with `error.kind=unhandledrejection` |
| a click | a breadcrumb — `button#pay`, never the element's text |
| a navigation | a breadcrumb with the new address and the previous one |
| a `fetch` | a breadcrumb with method, address, status and duration |

The browser keeps reporting errors on its own: we add a listener, we never
replace `window.onerror`, and we never call `preventDefault()`.

Breadcrumbs stay in memory — a queue of 20 — and ride along **only with `error`
and `fatal` logs**, as a single 4 KB attribute. Attaching 4 KB to each of 500
events would make a batch the ingestion refuses outright.

```ts
init({ breadcrumbs: { attachFrom: 'info', max: 40 } })
init({ breadcrumbs: false })
```

## The session, and who the user is

Each tab gets a session: a UUID in `sessionStorage`, restarted after 30 minutes
with no logs, surviving a reload.

```ts
nekolog.setUser('u_42')   // after login
nekolog.setUser(null)     // after logout
nekolog.resetSession()    // also on logout
```

`setUser` takes an identifier and nothing else. **There is nowhere to put a name
or an e-mail**, on purpose: the dashboard does not need them to group anything,
and a free-form user field is exactly where personal data leaks into logs. If
you need more, `logger.child({ attributes: … })` goes through the redaction
filter.

## The page address loses its query string

Every event carries `page.url`, and by default **without the query string and
without the fragment** — reset tokens, invite codes and coupons travel there. A
`?token=…` in a log is a leak nobody goes looking for.

```ts
init({ page: 'full' })   // keep the query, if you know what is in it
init({ page: false })    // no address at all
```

## Leaving the page

`pagehide` is the last event a page reliably gets, and it is exactly where a
normal `fetch` can be killed along with the tab. So the batch leaves through
`navigator.sendBeacon`, which the browser delivers after the page is gone.

`sendBeacon` cannot send a header, which is the one and only reason the key goes
**in the URL** on that path (`/v1/logs?key=nekolog_pk_…`); every other send keeps
it in `Authorization`. Two consequences: the browser batch is capped at 60 KB,
the beacon's quota, and a refused beacon falls back to `fetch` with `keepalive`
rather than losing the batch.

## Offline

A batch that could not leave — subway, plane, hotel wifi — is kept in IndexedDB
and sent again when the network returns, **and on the next visit too**, without
waiting for any event. The error that happened offline and closed the tab
arrives when the person opens the site again.

```ts
init({ offline: { maxBatches: 50, maxBytes: 2 * 1024 * 1024, maxAgeMs: 7 * 86_400_000 } })
init({ offline: false })
```

Only a **transport failure** is parked. A `400` is a refusal the server will
repeat, so that batch is dropped instead of retrying forever. The stored record
is `{at, url, body}` only — the `Authorization` header is rebuilt from the live
key, because a key in a browser database is a credential at rest for nothing.

## Server-side rendering

The package touches no `window`, `document` or `sessionStorage` at import time,
and guards every access. A component shared between server and client can import
it and log from both sides; on the server the `install*` functions install
nothing and the session stays in memory.

## Next

- [Distributed tracing](/docs/guides/tracing/) — connect this page's click to
  the request it caused, and the CORS header your back-end has to allow.
- [React](/docs/guides/react/) — provider, `useLogger` and an error boundary.
