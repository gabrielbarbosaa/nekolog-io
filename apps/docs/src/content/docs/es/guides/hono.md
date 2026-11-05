---
title: Hono
description: Un middleware, cualquier runtime y la cabecera que el navegador necesita en CORS.
---

```bash
npm install @nekolog-io/hono @nekolog-io/node
```

```ts
import { Hono } from 'hono'
import { createLogger } from '@nekolog-io/node'
import { nekolog } from '@nekolog-io/hono'

const log = createLogger({ service: 'checkout-api' })

const app = new Hono()
app.use('*', nekolog(log))

app.get('/orders/:id', (c) => {
  log.info('Pedido leído', { orderId: c.req.param('id') })
  return c.json({ ok: true })
})
```

Un solo middleware hace las tres cosas, porque en Hono todo ocurre alrededor del
mismo `await next()`.

| Opción | |
|---|---|
| `accessLog: false` | mantiene el contexto, quita la línea por respuesta |
| `newRequestId` | tu propio generador de ids |

## La línea sale aunque `next()` rechace

`record()` vive en un `finally`. Si un middleware más abajo lanza, la petición
igualmente recibe su línea de acceso — y el error **sigue subiendo**, no se lo
traga nadie.

Hono trata el error del handler internamente y devuelve 500, así que ese camino
no aparece en una prueba vía `app.request()`. Hay una prueba que llama al
middleware directamente con un `next` que rechaza, que es la única forma de
verlo.

## La ruta es el patrón

`c.req.routePath` cuando existe, y la ruta literal cuando Hono coincidió con
`/*` — si no, toda petición sin coincidencia se volvería la misma ruta. Nada
coincidente se convierte en `unmatched`.

## Runtimes

El middleware depende de `@nekolog-io/node`, que usa `AsyncLocalStorage` de
`node:async_hooks`. Eso existe en Node, Bun, Deno y Cloudflare Workers (con
`nodejs_compat`). No existe en un navegador, pero un middleware de servidor no
corre ahí.

En Workers, recuerda que el isolate puede congelarse en cuanto sale la
respuesta. Vacía antes de responder, o entrega la promesa a `waitUntil`:

```ts
app.use('*', async (c, next) => {
  await next()
  c.executionCtx.waitUntil(log.flush())
})
```

## Permitir `traceparent` en CORS

Un navegador de otro origen que envía `traceparent` (que es lo que hace
[el SDK de navegador](/docs/es/guides/browser/) para los destinos que
configures) dispara un preflight de CORS por esa cabecera personalizada.
Permítela:

```ts
import { cors } from 'hono/cors'

app.use(
  '*',
  cors({
    origin: 'https://shop.test',
    allowHeaders: ['content-type', 'authorization', 'traceparent'],
    exposeHeaders: ['traceparent', 'x-request-id'],
  }),
)
```

`allowHeaders` deja entrar la cabecera; `exposeHeaders` deja que la página lea el
`traceparent` y el `x-request-id` que vuelven. Mira
[Trazas distribuidas](/docs/es/guides/tracing/).
