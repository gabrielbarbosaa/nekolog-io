---
title: pino
description: Envía a NekoLog las mismas líneas que pino ya escribe, sin reescribir ninguna.
---

```bash
npm install @nekolog-io/pino @nekolog-io/node
```

```ts
import pino from 'pino'
import { createLogger, installProcessHooks } from '@nekolog-io/node'
import { nekologDestination } from '@nekolog-io/pino'

const nekolog = createLogger({ service: 'pedidos' })
installProcessHooks(nekolog)

const log = pino(
  { level: 'info' },
  pino.multistream([
    { stream: process.stdout },
    { stream: nekologDestination(nekolog) },
  ]),
)

log.info({ orderId: 123 }, 'Pedido creado')
```

Nada cambia en tu aplicación. Sigues llamando a pino.

## Una destination, no un transport en worker thread

pino ejecuta un `transport` en un worker aparte, lo que significaría otro
logger, otra cola y otro vaciado que acertar en el apagado. Una destination
mantiene el envío por lotes que el servicio ya tiene, y `pino.multistream` sigue
escribiendo en la salida estándar como antes.

## El nivel es el número que pino escribió

| pino | NekoLog |
|---|---|
| 60 | `fatal` |
| 50 | `error` |
| 40 | `warn` |
| 30 | `info` |
| 20 | `debug` |
| menos | `trace` |

Un nivel personalizado cae al escalón de abajo: 35 es `info`, 70 es `fatal`.

## El error y el `msg` no se pelean

pino serializa el error en `err` y deja la línea humana en `msg`. Si ambos
existen y son distintos, el error pasa a ser el error del evento (con su tipo y
su pila) y el `msg` viaja en el atributo `log.msg`. No se pierde nada.

Cualquier otro campo de la línea se convierte en atributo. Los campos propios de
pino (`level`, `time`, `msg`, `err`, `v`) se omiten; `skip` cambia esa lista.

## Una línea rota no tumba nada

Las líneas llegan por un stream, así que una puede venir partida en dos
escrituras: lo que sobra se guarda hasta el `\n`. Si nunca llega un `\n`, el
buffer se detiene en 1 MB y avisa por `onError` en vez de crecer para siempre.

Una línea que no es JSON se reporta y se salta. JSON que no es un objeto (`[]`,
`42`, `null`) se salta sin ruido: no es culpa de nadie, simplemente no es una
línea de log.

## Vaciado

Cerrar el stream vacía el logger de NekoLog. En una función serverless, llama a
`await nekolog.flush()` antes de retornar de todos modos — mira
[Node.js](/docs/es/guides/node/).
