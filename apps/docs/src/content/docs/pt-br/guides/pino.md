---
title: pino
description: Mande para o NekoLog as mesmas linhas que o pino já escreve, sem reescrever nenhuma.
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

log.info({ orderId: 123 }, 'Pedido criado')
```

Nada muda na sua aplicação. Você continua chamando o pino.

## Uma destination, não um transport de worker thread

O pino roda `transport` num worker separado, o que significaria outro logger,
outra fila e outro flush para acertar no desligamento. Uma destination mantém o
envio em lote que o serviço já tem, e o `pino.multistream` continua mandando
para a saída padrão como antes.

## O nível é o número que o pino escreveu

| pino | NekoLog |
|---|---|
| 60 | `fatal` |
| 50 | `error` |
| 40 | `warn` |
| 30 | `info` |
| 20 | `debug` |
| menos | `trace` |

Um nível personalizado cai no degrau de baixo: 35 é `info`, 70 é `fatal`.

## O erro e o `msg` não brigam

O pino serializa o erro em `err` e deixa a linha humana em `msg`. Se os dois
existem e são diferentes, o erro vira o erro do evento (com tipo e pilha) e o
`msg` vai junto no atributo `log.msg`. Nada se perde.

Todo outro campo da linha vira atributo. Os campos do próprio pino (`level`,
`time`, `msg`, `err`, `v`) são pulados; o `skip` muda essa lista.

## Uma linha quebrada não derruba nada

As linhas chegam por stream, então uma pode vir partida em duas escritas: o que
sobra fica guardado até o `\n`. Se nunca vier `\n`, o buffer para em 1 MB e
avisa pelo `onError` em vez de crescer para sempre.

Linha que não é JSON é reportada e pulada. JSON que não é objeto (`[]`, `42`,
`null`) é pulado sem alarde: não é erro de ninguém, só não é uma linha de log.

## Flush

Fechar o stream dá flush no logger do NekoLog. Numa função serverless, chame
`await nekolog.flush()` antes de retornar assim mesmo — veja
[Node.js](/docs/pt-br/guides/node/).
