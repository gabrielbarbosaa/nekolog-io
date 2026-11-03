# @nekolog-io/winston

Transport do NekoLog para o winston.

```ts
import { NekologTransport } from '@nekolog-io/winston'
import { createLogger } from '@nekolog-io/node'
import winston from 'winston'

const nekolog = createLogger({ service: 'pedidos' })

const log = winston.createLogger({
  transports: [new winston.transports.Console(), new NekologTransport({ logger: nekolog })],
})
```

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
nível **real** — `info.level` pode ter sido colorido ou reescrito por um
formato.

## A mensagem do erro vem da pilha

Quando você escreve `log.error('pagamento falhou', erro)`, o winston **junta**
os dois em `info.message`: vira `"pagamento falhou card is undefined"`. Ler o
erro dali daria uma mensagem de erro que o erro nunca teve.

Então o tipo e a mensagem saem da primeira linha de `info.stack`, que é o que o
`Error` de verdade escreveu. A linha que o winston montou fica no atributo
`log.msg`. E o tipo só é aceito se parecer um identificador — uma frase com
dois-pontos no meio não vira nome de erro.

## O transport não derruba o winston

Se o nosso logger levantar, o erro vai para o `onError` e o `next()` do winston
é chamado assim mesmo. Um transport que não chama de volta trava a cadeia
inteira — e o log de um serviço não pode ser o motivo de ele parar.
