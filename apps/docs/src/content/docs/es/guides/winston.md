---
title: winston
description: Añade un transport y quédate con el logger que ya tienes.
---

```bash
npm install @nekolog-io/winston @nekolog-io/node
```

```ts
import winston from 'winston'
import { createLogger, installProcessHooks } from '@nekolog-io/node'
import { NekologTransport } from '@nekolog-io/winston'

const nekolog = createLogger({ service: 'pedidos' })
installProcessHooks(nekolog)

const log = winston.createLogger({
  transports: [
    new winston.transports.Console(),
    new NekologTransport({ logger: nekolog }),
  ],
})

log.info('Pedido creado', { orderId: 123 })
```

Nada cambia en tu aplicación. Sigues llamando a winston.

## Los dos juegos de niveles

winston trae los niveles `npm` por defecto y los `syslog` como opción, y ambos
se aceptan:

| winston | NekoLog |
|---|---|
| `error` | `error` |
| `warn`, `warning` | `warn` |
| `info`, `notice` | `info` |
| `http`, `verbose`, `debug` | `debug` |
| `silly` | `trace` |
| `emerg`, `alert`, `crit` | `fatal` |

El nivel se lee de `Symbol.for('level')`, que es donde winston guarda el nivel
**real** — `info.level` puede haber sido coloreado o reescrito por un formato.

## El mensaje del error viene de la pila

Cuando escribes `log.error('pago fallido', err)`, winston **concatena** ambos en
`info.message`: queda `"pago fallido card is undefined"`. Leer el error de ahí
le daría un mensaje que nunca tuvo.

Así que el tipo y el mensaje salen de la primera línea de `info.stack`, que es lo
que el `Error` de verdad escribió. La línea que winston montó queda en el
atributo `log.msg`. Y el tipo solo se acepta si parece un identificador — una
frase con dos puntos en medio no se convierte en nombre de error.

Cualquier otro campo del objeto se convierte en atributo; `level`, `message` y
`stack` se omiten, y `skip` cambia esa lista.

## El transport no atasca winston

Si nuestro logger lanza, el error va a `onError` y el `next()` de winston se
llama igualmente. Un transport que no devuelve la llamada atasca toda la cadena
— y el logging de un servicio no puede ser el motivo de que se detenga.

```ts
new NekologTransport({
  logger: nekolog,
  onError: (error) => console.warn('nekolog', error),
})
```

## Vaciado

Cerrar el transport vacía el logger de NekoLog. En una función serverless, llama
a `await nekolog.flush()` antes de retornar de todos modos — mira
[Node.js](/docs/es/guides/node/).
