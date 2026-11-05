---
title: NestJS
description: A global module, an interceptor, and Nest's own logs on the same path.
---

```bash
npm install @nekolog-io/nestjs @nekolog-io/node
```

```ts
import { Module } from '@nestjs/common'
import { NekologModule } from '@nekolog-io/nestjs'

@Module({
  imports: [NekologModule.forRoot({ service: 'orders' })],
  controllers: [OrdersController],
})
export class AppModule {}
```

```ts
import { Controller, Get, Inject, Param } from '@nestjs/common'
import { NEKOLOG_LOGGER, type Logger } from '@nekolog-io/nestjs'

@Controller('orders')
export class OrdersController {
  constructor(@Inject(NEKOLOG_LOGGER) private readonly log: Logger) {}

  @Get(':id')
  read(@Param('id') id: string) {
    this.log.info('Order read', { orderId: id })
    return { ok: true }
  }
}
```

`forRoot` is global by default, registers the interceptor as `APP_INTERCEPTOR`
and exports the logger under the `NEKOLOG_LOGGER` token.

| Option | |
|---|---|
| `global: false` | import the module where you need it instead |
| `interceptor: false` | no request context and no access line; just the logger |
| everything else | the [Node logger's options](/docs/guides/node/) |

For options that come from the `ConfigService`:

```ts
NekologModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    apiKey: config.get('NEKOLOG_KEY'),
    service: 'orders',
  }),
})
```

## Nest's own logs

```ts
const app = await NestFactory.create(AppModule)
app.useLogger(new NekologLoggerService(app.get(NEKOLOG_LOGGER)))
```

Nest passes its context (`RouterExplorer`, `NestFactory`…) as the last argument
and the stack as the first one on an `error`. Both become attributes:
`nest.context` and `stack`.

## The context crosses the subscription, not the call

A Nest interceptor returns an `Observable`, and the controller only runs when
something **subscribes** to it — after `intercept` has already returned. Opening
the `AsyncLocalStorage` around `next.handle()` solves nothing: the handler would
run outside it.

So `intercept` returns a new `Observable` and does the **subscription** inside
`runWithContext`. There is a test with three concurrent requests checking the
request ids do not mix.

## The error status comes from the error

When a handler throws, Nest's exception filter has **not yet** adjusted
`response.statusCode` at the moment the interceptor is told — it is still 200.
Reading it there would turn a 500 into an `info` line.

So on the error path the status comes from the error itself: `getStatus()` of an
`HttpException`, or a `status` field, or 500. Only a code between 400 and 599;
anything else is 500. **That bug existed, and an end-to-end test is what found
it.**

## No decorator syntax inside the package

The package uses no `@Decorator` anywhere, so it compiles without
`experimentalDecorators` or `emitDecoratorMetadata`. Your application of course
uses them — Nest is built on them — but the dependency does not force the
setting on you.

## Allowing `traceparent` through CORS

A browser on another origin sending `traceparent` (which
[the browser SDK](/docs/guides/browser/) does for the targets you configure)
triggers a CORS preflight for that custom header. Allow it:

```ts
app.enableCors({
  origin: 'https://shop.test',
  allowedHeaders: ['content-type', 'authorization', 'traceparent'],
  exposedHeaders: ['traceparent', 'x-request-id'],
})
```

`allowedHeaders` lets the header come **in**; `exposedHeaders` lets the page
read the `traceparent` and `x-request-id` that come back. See
[Distributed tracing](/docs/guides/tracing/).
