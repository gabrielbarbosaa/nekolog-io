---
title: Primeros pasos
description: Envía tu primer log desde una aplicación Node.js.
---

:::caution[Necesitas una invitación antes]
Los paquetes `@nekolog-io/*` no son públicos. Tu invitación trae las
credenciales del registro y las claves de tu primer proyecto; configúralas
antes de que los comandos de abajo funcionen.
:::

## Instalación

```bash
npm install @nekolog-io/node
```

## Enviando un log

```ts
import { createLogger } from '@nekolog-io/node'

const log = createLogger({
  apiKey: process.env.NEKOLOG_KEY!, // la clave ya identifica proyecto + entorno
  service: 'checkout-api',
  release: '1.4.2',
})

log.info('Pedido creado', { orderId: 123 })
log.child({ requestId }).error(err, { step: 'pago' })

await log.flush() // importante en serverless, donde el proceso puede terminar antes
```

## Qué esperar

- Los logs se envían por lotes, con gzip, reintentos y backoff. Un fallo de
  envío nunca rompe tu aplicación.
- `flush()` espera a que se entregue todo lo que está en cola. Llámalo antes de
  que una función serverless retorne, o al apagar el proceso.
- Los datos sensibles (`password`, `token`, `authorization`, `cpf`, números de
  tarjeta) se eliminan por defecto, antes de que nada salga de tu proceso.

## Próximos pasos

- [`nekolog init`](/docs/es/guides/cli/) — un comando que detecta el framework,
  instala el SDK correcto y escribe el `.env`.
- [Plugin de bundler](/docs/es/guides/bundler-plugin/) — registra la release y
  sube los source maps desde dentro de tu build de Vite, webpack, Rollup o
  esbuild.
- La guía de tu stack: [Browser](/docs/es/guides/browser/),
  [React](/docs/es/guides/react/), [Next.js](/docs/es/guides/next/),
  [Node.js](/docs/es/guides/node/), [Express](/docs/es/guides/express/),
  [Fastify](/docs/es/guides/fastify/), [Hono](/docs/es/guides/hono/),
  [NestJS](/docs/es/guides/nestjs/), [pino](/docs/es/guides/pino/) o
  [winston](/docs/es/guides/winston/).
- [Trazas distribuidas](/docs/es/guides/tracing/) — una sola línea de tiempo
  entre el front y el back, y la cabecera que necesita en CORS.
- [Alertas](/docs/es/guides/alerts/) — los cinco tipos de regla, y cómo
  verificar que un webhook vino de verdad de NekoLog.
- [La API pública](/docs/es/api/reference/) y su
  [lenguaje de búsqueda](/docs/es/api/search/) — lee por tu cuenta todo lo que
  muestra el dashboard. ¿Ya usas OpenTelemetry? Hay
  [endpoint OTLP](/docs/es/api/otlp/).
- [Qué se guarda](/docs/es/reference/privacy/) — qué nunca sale de tu proceso,
  qué quita el servidor, y qué no se escribe nunca.
- [Versionado y soporte](/docs/es/reference/versioning/) — qué promete un
  cambio, y cuánto dura una versión antigua.
- [Introducción](/docs/es/getting-started/introduction/) — cómo encajan las
  piezas y qué recibes.
