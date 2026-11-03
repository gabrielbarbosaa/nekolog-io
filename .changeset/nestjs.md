---
'@nekolog-io/nestjs': minor
---

Add `@nekolog-io/nestjs`: `NekologModule.forRoot`/`forRootAsync`, a `NekologInterceptor` registered as `APP_INTERCEPTOR`, and a `NekologLoggerService` for Nest's own output. The interceptor opens the `AsyncLocalStorage` around the **subscription**, not around `next.handle()` — a Nest interceptor returns an Observable and the controller only runs when something subscribes, after `intercept` has already returned, so wrapping the call would leave the handler outside the context. On the error path the status comes from the error (`HttpException.getStatus()`, a `status` field, else 500) rather than from the response, because Nest's exception filter has not set `response.statusCode` yet when the interceptor is told — reading it there logged a 500 as `info`, and an end-to-end test caught exactly that. The package uses no decorator syntax at all, so it needs neither `experimentalDecorators` nor `emitDecoratorMetadata` to compile.
