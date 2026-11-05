---
title: Node.js
description: Contexto por petición, hooks de proceso y las variables de entorno que el SDK lee.
---

```bash
npm install @nekolog-io/node
```

```ts
import { createLogger, installProcessHooks } from '@nekolog-io/node'

const log = createLogger({ service: 'checkout-api', release: '1.4.2' })
installProcessHooks(log)

log.info('Pedido creado', { orderId: 123 })
await log.flush()
```

Este es el paquete sobre el que se apoya cada integración de servidor:
[Express](/docs/es/guides/express/), [Fastify](/docs/es/guides/fastify/),
[Hono](/docs/es/guides/hono/), [NestJS](/docs/es/guides/nestjs/) y la mitad de
servidor de [Next.js](/docs/es/guides/next/) lo usan todos.

## Variables de entorno

Sin opción explícita, valen estas:

| Variable | Para qué |
|---|---|
| `NEKOLOG_KEY` | la clave; ya determina proyecto y entorno |
| `NEKOLOG_ENDPOINT` | otro destino, si el tuyo no es el predeterminado |
| `NEKOLOG_SERVICE` | el nombre del servicio |
| `NEKOLOG_RELEASE` | la versión desplegada |
| `NEKOLOG_LEVEL` | el nivel mínimo |

Lo que pasas en código gana a la variable. Una variable en blanco se trata como
ausente, no como cadena vacía, y un `NEKOLOG_LEVEL` que no existe se **ignora y
se avisa** por `onError` en vez de tumbar el logger.

## Contexto por petición

`runWithContext` ata un contexto a toda la rama asíncrona. El logger lee ese
contexto **en cada llamada**, así que no hay que recrearlo por petición ni
pasarlo de mano en mano:

```ts
runWithContext({ attributes: { requestId }, trace }, async () => {
  await handle()
})
```

| | |
|---|---|
| `runWithContext(ctx, fn)` | ejecuta `fn` con `ctx` sumado a lo que ya valía |
| `addContext(ctx)` | añade al ámbito que ya está corriendo; devuelve `false` si no hay ninguno |
| `bindContext(ctx, fn)` | devuelve `fn` con el contexto pegado, para un callback que corre después |
| `currentContext()` | el contexto vigente ahora, o `undefined` |

Los ámbitos anidados **se suman**, y el de dentro gana en una clave repetida. Lo
que pasas en la llamada (`log.child(...)` o el segundo argumento) gana al
contexto ambiente — el ambiente es fondo, no una orden.

`addContext` solo alcanza el ámbito actual y los que nazcan de él. **No** vuelve
hacia afuera: descubrir el `userId` a mitad de una petición no debería filtrarse
a la siguiente.

Las peticiones simultáneas no se mezclan, y hay una prueba con tres peticiones
intercaladas a propósito.

### Un listener no hereda el contexto

Un listener de evento corre bajo el contexto activo cuando el evento se emite —
en una respuesta con backpressure, el del socket, no el de la petición.
Envuélvelo:

```ts
response.on('finish', bindContext(currentContext(), escribir))
```

## Hooks de proceso

Crear el logger no toca `process`. Quien lo toca es esta llamada,
explícitamente, porque cambiar cómo sale un proceso a espaldas de quien instaló
el paquete es como se consigue un proceso zombi en producción.

```ts
const uninstall = installProcessHooks(log, {
  signals: ['SIGTERM'],
  flushTimeoutMs: 5000,
})
```

| Evento | Qué pasa |
|---|---|
| `uncaughtException` | escribe el error en stderr, lo loguea como `fatal`, vacía, **y entonces sí sale con 1** |
| `unhandledRejection` | lo mismo |
| `SIGTERM`, `SIGINT` | vacía y deja que la señal haga lo que iba a hacer |
| `beforeExit` | vacía una vez y se aparta |

Tres cosas que valen más que la tabla:

- **El comportamiento por defecto de Node se conserva.** Instalar un listener de
  `uncaughtException` hace que Node deje de tumbar el proceso — así es como un
  servicio se vuelve zombi reteniendo conexiones. Por eso la pila sigue yendo a
  stderr y el proceso sigue saliendo con 1. `exitOnFatal: false` lo desactiva,
  si de verdad lo quieres.
- **Si la app ya lo trata, el SDK no decide.** Con otro listener de
  `uncaughtException` registrado no salimos: quien lo registró tiene un plan. Con
  otro listener de `SIGTERM` (apagado ordenado), vaciamos y nos apartamos.
- **El vaciado tiene plazo.** `flushTimeoutMs` (2 s por defecto) impide que una
  red atascada retenga el apagado para siempre. Una red que se cae no puede
  convertirse en un despliegue atascado.

## Serverless

`await log.flush()` antes de devolver la respuesta es **obligatorio** donde el
proceso puede congelarse o morir justo después de que el handler retorne.

## Llamadas salientes

`installTracePropagation({ targets })` añade la cabecera `traceparent` del W3C a
las llamadas que hace tu servicio. `targets` es obligatorio y no tiene valor por
defecto — mira [Trazas distribuidas](/docs/es/guides/tracing/).
