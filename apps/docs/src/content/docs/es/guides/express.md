---
title: Express
description: Contexto por petición, una línea de acceso por respuesta y la cabecera que el navegador necesita en CORS.
---

```bash
npm install @nekolog-io/express @nekolog-io/node
```

```ts
import express from 'express'
import { createLogger, installProcessHooks } from '@nekolog-io/node'
import { withAccessLog, withErrorLog, withLogContext } from '@nekolog-io/express'

const log = createLogger({ service: 'checkout-api' })
installProcessHooks(log)

const app = express()

app.use(withLogContext())
app.use(withAccessLog(log))

app.get('/orders/:id', (request, response) => {
  log.info('Pedido leído', { orderId: request.params.id })
  response.json({ ok: true })
})

app.use(withErrorLog(log))
```

**El orden importa.** `withLogContext` abre el ámbito, así que va primero;
`withErrorLog` es un manejador de errores, así que va después de las rutas.

| | |
|---|---|
| `withLogContext()` | lee `traceparent` y `x-request-id`, responde con ambos y ata el contexto a la petición |
| `withAccessLog(log)` | una línea por respuesta, con método, ruta, estado y duración |
| `withErrorLog(log)` | loguea el error y lo **pasa adelante** — quien responde es tu manejador |

## La ruta es el patrón, no la dirección

`GET /orders/:id 200`, nunca `GET /orders/ord_7f3a91 200`. Si no, cada id se
convierte en una ruta y ningún gráfico agrupa nada. Una petición que no coincidió
con ninguna ruta se registra como `unmatched`, no como la ruta literal.

## El `x-request-id` entrante se verifica

Hasta 64 caracteres de `[A-Za-z0-9._:-]`. Cualquier otra cosa — `\r\n`, un
espacio, `../`, una etiqueta de script — se descarta y se genera un id nuevo. Ese
valor sale de vuelta en una cabecera de respuesta: confiar en lo que llegó sería
dejar que el cliente escriba cabeceras.

## `withErrorLog` no responde

Loguea y llama a `next(error)`. Decidir el cuerpo y el estado de una respuesta
de error es de la app, no de un paquete de logging — y si nuestro log falla, el
error **igualmente** llega al siguiente manejador.

## Permitir `traceparent` en CORS

Si un navegador de otro origen envía `traceparent` (que es lo que hace
[el SDK de navegador](/docs/es/guides/browser/) para los destinos que
configures), esa cabecera personalizada dispara un preflight de CORS. Tu API
tiene que permitirla, o la petición falla antes de empezar:

```ts
import cors from 'cors'

app.use(
  cors({
    origin: 'https://shop.test',
    allowedHeaders: ['content-type', 'authorization', 'traceparent'],
    exposedHeaders: ['traceparent', 'x-request-id'],
  }),
)
```

`allowedHeaders` es lo que deja que la petición lleve la cabecera **hacia
dentro**; `exposedHeaders` es lo que deja que la página lea el `traceparent` y
el `x-request-id` que vuelven — útil cuando quieres mostrar un id de petición en
una pantalla de error. Mira [Trazas distribuidas](/docs/es/guides/tracing/).

## El listener de `finish` va atado al contexto

Esto está en el paquete, no es algo que escribas, pero vale saber por qué la
línea de acceso sigue llevando lo que la ruta añadió con `addContext`: un
listener de evento **no** hereda el `AsyncLocalStorage` de quien lo registró.
Corre bajo el contexto activo cuando el evento se emite, que en una respuesta con
backpressure es el del socket. Por eso el `finish` va envuelto en `bindContext`.
