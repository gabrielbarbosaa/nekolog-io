---
title: pino
description: Send the lines pino already writes to NekoLog, without rewriting any of them.
---

:::caution[Not on npm yet]
The `@nekolog-io/*` packages have not been published. This page describes the
behaviour the code already has, so the shape of the API is clear.
:::

```bash
npm install @nekolog-io/pino @nekolog-io/node
```

```ts
import pino from 'pino'
import { createLogger, installProcessHooks } from '@nekolog-io/node'
import { nekologDestination } from '@nekolog-io/pino'

const nekolog = createLogger({ service: 'orders' })
installProcessHooks(nekolog)

const log = pino(
  { level: 'info' },
  pino.multistream([
    { stream: process.stdout },
    { stream: nekologDestination(nekolog) },
  ]),
)

log.info({ orderId: 123 }, 'Order created')
```

Nothing in your application changes. You keep calling pino.

## A destination, not a worker transport

pino runs a `transport` in a separate worker thread, which would mean a second
logger, a second queue and a second flush to get right at shutdown. A
destination keeps the batching the service already has, and `pino.multistream`
goes on writing to standard output as before.

## The level is the number pino wrote

| pino | NekoLog |
|---|---|
| 60 | `fatal` |
| 50 | `error` |
| 40 | `warn` |
| 30 | `info` |
| 20 | `debug` |
| lower | `trace` |

A custom level falls to the step below: 35 is `info`, 70 is `fatal`.

## The error and the message do not fight

pino serialises the error into `err` and leaves the human line in `msg`. When
both exist and differ, the error becomes the event's error (with its type and
stack) and `msg` rides along in the `log.msg` attribute. Nothing is lost.

Every other field on the line becomes an attribute. pino's own fields
(`level`, `time`, `msg`, `err`, `v`) are skipped; `skip` changes that list.

## A broken line does not take anything down

Lines arrive through a stream, so one can be split across two writes: what is
left over is held until the `\n`. If a `\n` never comes, the buffer stops at
1 MB and reports through `onError` instead of growing forever.

A line that is not JSON is reported and skipped. JSON that is not an object
(`[]`, `42`, `null`) is skipped quietly — it is nobody's mistake, it just is not
a log line.

## Flushing

Closing the stream flushes the NekoLog logger. In a serverless function, call
`await nekolog.flush()` before returning anyway — see
[Node.js](/docs/guides/node/).
