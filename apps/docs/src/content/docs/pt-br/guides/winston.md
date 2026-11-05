---
title: winston
description: Acrescente um transport e continue com o logger que você já tem.
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

log.info('Pedido criado', { orderId: 123 })
```

Nada muda na sua aplicação. Você continua chamando o winston.

## Os dois conjuntos de níveis

O winston traz os níveis `npm` por padrão e os `syslog` como opção, e os dois
são aceitos:

| winston | NekoLog |
|---|---|
| `error` | `error` |
| `warn`, `warning` | `warn` |
| `info`, `notice` | `info` |
| `http`, `verbose`, `debug` | `debug` |
| `silly` | `trace` |
| `emerg`, `alert`, `crit` | `fatal` |

O nível vem do símbolo `Symbol.for('level')`, que é onde o winston guarda o
nível **real** — o `info.level` pode ter sido colorido ou reescrito por um
formato.

## A mensagem do erro vem da pilha

Quando você escreve `log.error('pagamento falhou', erro)`, o winston **junta**
os dois em `info.message`: vira `"pagamento falhou card is undefined"`. Ler o
erro dali daria uma mensagem que o erro nunca teve.

Então o tipo e a mensagem saem da primeira linha de `info.stack`, que é o que o
`Error` de verdade escreveu. A linha que o winston montou fica no atributo
`log.msg`. E o tipo só é aceito se parecer um identificador — uma frase com
dois-pontos no meio não vira nome de erro.

Todo outro campo do objeto vira atributo; `level`, `message` e `stack` são
pulados, e o `skip` muda essa lista.

## O transport não trava o winston

Se o nosso logger levantar, o erro vai para o `onError` e o `next()` do winston
é chamado assim mesmo. Um transport que não chama de volta trava a cadeia
inteira — e o log de um serviço não pode ser o motivo de ele parar.

```ts
new NekologTransport({
  logger: nekolog,
  onError: (error) => console.warn('nekolog', error),
})
```

## Flush

Fechar o transport dá flush no logger do NekoLog. Numa função serverless, chame
`await nekolog.flush()` antes de retornar assim mesmo — veja
[Node.js](/docs/pt-br/guides/node/).
