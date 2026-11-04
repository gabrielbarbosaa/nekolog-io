---
title: Fastify
description: Un plugin, tres hooks y la cabecera que el navegador necesita en CORS.
---

:::caution[Todavía no está en npm]
Los paquetes `@nekolog-io/*` aún no se han publicado. Esta página describe el
comportamiento que el código ya tiene, para que la forma de la API quede clara.
:::

```bash
npm install @nekolog-io/fastify @nekolog-io/node
```

```ts
import Fastify from 'fastify'
import { createLogger, installProcessHooks } from '@nekolog-io/node'
import { nekologPlugin } from '@nekolog-io/fastify'

const log = createLogger({ service: 'checkout-api' })
installProcessHooks(log)

const app = Fastify()
await app.register(nekologPlugin, { logger: log })

app.get('/orders/:id', async (request) => {
  log.info('Pedido leído', { orderId: request.params.id })
  return { ok: true }
})
```

Tres hooks: `onRequest` abre el contexto y responde con `traceparent` y
`x-request-id`, `onResponse` escribe la línea de acceso, `onError` loguea lo que
el handler lanzó.

| Opción | |
|---|---|
| `logger` | el logger, obligatorio |
| `accessLog: false` | mantiene el contexto y el log de error, quita la línea por respuesta |
| `newRequestId` | tu propio generador de ids |

## El plugin no se encapsula, a propósito

Lleva `Symbol.for('skip-override')`. Sin eso, Fastify encapsularía los hooks en
el ámbito del `register` y nada fuera de él se registraría, que es exactamente
lo contrario de para lo que sirve un plugin de logging.

Regístralo una sola vez, en la raíz. No hace falta repetirlo dentro de cada
plugin de tu app.

## El contexto atraviesa el `done()`

`onRequest` llama a `done()` **desde dentro** de `runWithContext`. Así es como
`AsyncLocalStorage` acompaña el resto del ciclo de la petición; llamar a
`done()` desde fuera haría que el handler corriera sin contexto, y el id de la
petición desaparecería de todo lo que registrara. Hay una prueba con tres
peticiones simultáneas comprobando que los ids no se mezclan.

## La ruta es el patrón

`request.routeOptions.url` en Fastify 4+, con `request.routerPath` como
alternativa para versiones anteriores. Si no hay ninguno, `unmatched`.

## Una cabecera que llegó dos veces

Node entrega un array cuando la misma cabecera viene repetida. El plugin toma la
primera e ignora lo que no sea texto — un `x-request-id` numérico no se
convierte en cadena por comodidad.

## Permitir `traceparent` en CORS

Un navegador de otro origen que envía `traceparent` (que es lo que hace
[el SDK de navegador](/docs/es/guides/browser/) para los destinos que
configures) dispara un preflight de CORS por esa cabecera personalizada.
Permítela:

```ts
import cors from '@fastify/cors'

await app.register(cors, {
  origin: 'https://shop.test',
  allowedHeaders: ['content-type', 'authorization', 'traceparent'],
  exposedHeaders: ['traceparent', 'x-request-id'],
})
```

`allowedHeaders` deja entrar la cabecera; `exposedHeaders` deja que la página lea
el `traceparent` y el `x-request-id` que vuelven. Mira
[Trazas distribuidas](/docs/es/guides/tracing/).
