# @nekolog-io/pino

Manda para o NekoLog as mesmas linhas que o pino já escreve.

```ts
import { nekologDestination } from "@nekolog-io/pino"
import { createLogger } from "@nekolog-io/node"
import pino from "pino"

const nekolog = createLogger({ service: "pedidos" })
const log = pino({ level: "info" }, pino.multistream([
  { stream: process.stdout },
  { stream: nekologDestination(nekolog) },
]))
```

E uma destination, nao um transport de worker thread. O pino roda transport
num worker separado, o que significa outro processo de logger, outra fila e
outro flush para acertar no desligamento. Aqui o lote e a fila sao os mesmos
que o resto do servico ja usa, e `pino.multistream` continua mandando para a
saida padrao.

## O nivel e o numero que o pino escreveu

| pino | NekoLog |
|---|---|
| 60 | `fatal` |
| 50 | `error` |
| 40 | `warn` |
| 30 | `info` |
| 20 | `debug` |
| menos | `trace` |

Um nivel personalizado cai no degrau de baixo: 35 e `info`, 70 e `fatal`.

## O erro e o `msg` nao brigam

O pino serializa o erro em `err` e deixa a linha humana em `msg`. Se os dois
existem e sao diferentes, o erro vira o erro do evento (com tipo e pilha) e o
`msg` vai junto no atributo `log.msg`. Nada se perde.

## Uma linha quebrada nao derruba nada

As linhas chegam por stream, entao uma pode vir partida em duas escritas: o que
sobra fica guardado ate o `\n`. Se nunca vier `\n`, o buffer para em 1 MB e
avisa pelo `onError` em vez de crescer para sempre.

Linha que nao e JSON e reportada e pulada. JSON que nao e objeto (`[]`, `42`,
`null`) e pulado sem alarde: nao e erro de ninguem, so nao e uma linha de log.
