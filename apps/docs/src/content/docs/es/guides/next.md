---
title: Next.js
description: register() en el servidor, el provider en el cliente, y el ámbito que un route handler no tiene.
---

```bash
npm install @nekolog-io/next
```

## El servidor

```ts
// instrumentation.ts
import { register as nekolog } from '@nekolog-io/next'

export function register() {
  nekolog({ service: 'tienda' })
}

export { onRequestError } from '@nekolog-io/next'
```

`register()` corre una vez por proceso por muchas veces que Next llame a
`instrumentation.ts` — dos loggers serían dos juegos de hooks en `process`. En
el runtime `nodejs` monta un [logger de Node](/docs/es/guides/node/) con los
hooks de `uncaughtException`, `unhandledRejection` y `SIGTERM`; en `edge` monta
un logger de core con `runtime: 'edge'` y **sin** hooks, porque no hay
`process` al que engancharse. Un `NEXT_RUNTIME` que no sea ninguno de los dos se
trata como `nodejs`, no se le cree.

## El cliente

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

**Dos entradas, y eso es estructural.** `@nekolog-io/next` es el servidor; tira
de `node:async_hooks` a través de `@nekolog-io/node`, lo que rompe en un bundle
de cliente. `@nekolog-io/next/client` está marcado `'use client'` y no importa
nada de Node. Importar la equivocada falla de inmediato, que es mejor que fallar
en producción.

La variable pública necesita la clave **pública**. Una `nekolog_sk_…` en una
variable `NEXT_PUBLIC_` va al bundle; el SDK la rechaza, pero la credencial ya
quedó publicada.

## `onRequestError`

Next entrega aquí los errores de servidor. Se convierten en logs `error` con:

| Atributo | De dónde viene |
|---|---|
| `http.path` | la ruta, **sin query string** |
| `http.method` | el método |
| `next.router` | `App Router` o `Pages Router` |
| `next.route` | la ruta con sus corchetes, `/checkout/[step]` |
| `next.render_source`, `next.revalidate_reason` | lo que Next contó |

**Las cabeceras nunca entran.** Ahí viven la cookie de sesión y el
`Authorization`, y hay una prueba que comprueba que ninguna aparece. Si el
logger falla, el handler **no** devuelve la excepción a Next: el error que se
estaba tratando importa más que el nuestro.

## Un route handler no tiene contexto por petición

Express, Fastify, Hono y Nest tienen cada uno un middleware que abre el
`AsyncLocalStorage`. Next no tiene ese gancho — `instrumentation.ts` corre una
vez por proceso y `proxy.ts` corre en otro runtime —, así que `addContext`
dentro de un route handler no tiene dónde escribir y el id de usuario nunca
aparece.

Abre el ámbito tú mismo, en unas diez líneas:

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

Esto vive en tu aplicación y no en el paquete porque la forma correcta depende
de la app: cómo se llama la ruta, si quieres las cabeceras de vuelta, qué hacer
ante un error. `examples/next` en el repositorio tiene el archivo completo.

## Permitir `traceparent` en CORS

Solo importa si un navegador de **otro origen** llama a estas rutas — una app
Next que llama a su propio `/api` es del mismo origen y no necesita nada. Cuando
sea entre orígenes, responde al preflight:

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

Mira [Trazas distribuidas](/docs/es/guides/tracing/).

## El resto

El contexto por petición, el `traceparent` y los hooks de proceso vienen de
[`@nekolog-io/node`](/docs/es/guides/node/); el provider, `useLogger` y el error
boundary vienen de [`@nekolog-io/react`](/docs/es/guides/react/). Este paquete
solo une los dos en la forma que Next espera.
