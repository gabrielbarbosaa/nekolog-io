---
title: Primeros pasos
description: Envía tu primer log desde una aplicación Node.js.
---

:::caution[Todavía no disponible]
Los paquetes `@nekolog-io/*` aún no se han publicado en npm, así que los
comandos de esta página todavía no funcionan. Están aquí para dejar clara la
forma de la API mientras se construye.
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

- [Introducción](/docs/es/getting-started/introduction/) — cómo encajan las
  piezas y qué es open source.
