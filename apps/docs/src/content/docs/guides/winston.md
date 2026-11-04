---
title: winston
description: Add a transport and keep the logger you already have.
---

:::caution[Not on npm yet]
The `@nekolog-io/*` packages have not been published. This page describes the
behaviour the code already has, so the shape of the API is clear.
:::

```bash
npm install @nekolog-io/winston @nekolog-io/node
```

```ts
import winston from 'winston'
import { createLogger, installProcessHooks } from '@nekolog-io/node'
import { NekologTransport } from '@nekolog-io/winston'

const nekolog = createLogger({ service: 'orders' })
installProcessHooks(nekolog)

const log = winston.createLogger({
  transports: [
    new winston.transports.Console(),
    new NekologTransport({ logger: nekolog }),
  ],
})

log.info('Order created', { orderId: 123 })
```

Nothing in your application changes. You keep calling winston.

## Both sets of levels

winston ships the `npm` levels by default and the `syslog` ones as an option,
and both are accepted:

| winston | NekoLog |
|---|---|
| `error` | `error` |
| `warn`, `warning` | `warn` |
| `info`, `notice` | `info` |
| `http`, `verbose`, `debug` | `debug` |
| `silly` | `trace` |
| `emerg`, `alert`, `crit` | `fatal` |

The level is read from `Symbol.for('level')`, which is where winston keeps the
**real** level — `info.level` may have been coloured or rewritten by a format.

## The error's message comes from the stack

When you write `log.error('payment failed', err)`, winston **concatenates** both
into `info.message`: it becomes `"payment failed card is undefined"`. Reading
the error from there would give it a message it never had.

So the type and the message come from the first line of `info.stack`, which is
what the real `Error` wrote. The line winston assembled is kept in the `log.msg`
attribute. And the type is only accepted if it looks like an identifier — a
sentence with a colon in the middle does not become an error name.

Every other field on the info object becomes an attribute; `level`, `message`
and `stack` are skipped, and `skip` changes that list.

## The transport does not stall winston

If our logger throws, the error goes to `onError` and winston's `next()` is
called anyway. A transport that does not call back stalls the whole chain — and
a service's logging cannot be the reason the service stops.

```ts
new NekologTransport({
  logger: nekolog,
  onError: (error) => console.warn('nekolog', error),
})
```

## Flushing

Closing the transport flushes the NekoLog logger. In a serverless function,
call `await nekolog.flush()` before returning anyway — see
[Node.js](/docs/guides/node/).
