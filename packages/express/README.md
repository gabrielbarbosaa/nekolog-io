# @nekolog-io/express

Middleware do NekoLog para Express: contexto por request, linha de acesso e log
de erro. O trabalho compartilhado com o Fastify e o Hono mora no
[`@nekolog-io/node`](../node/README.md); aqui fica o que é do Express.

```ts
import { withAccessLog, withErrorLog, withLogContext } from '@nekolog-io/express'

app.use(withLogContext())
app.use(withAccessLog(log))
// suas rotas
app.use(withErrorLog(log))
```

| | |
|---|---|
| `withLogContext()` | lê o `traceparent` e o `x-request-id`, responde com os dois e prende o contexto na request |
| `withAccessLog(log)` | uma linha por resposta, com método, rota, status e duração |
| `withErrorLog(log)` | loga o erro e **passa adiante** — quem responde é o seu handler |

## O ouvinte do `finish` é amarrado ao contexto

Um listener de evento **não** herda o `AsyncLocalStorage` de quem o registrou:
ele roda no contexto que estiver ativo quando o evento sai, que numa resposta
com backpressure é o do socket, não o da request. Por isso o `finish` vai
embrulhado em `bindContext`.

Isso passa despercebido num teste rápido, porque o `finish` costuma sair ainda
dentro da pilha. Tem um teste que dispara o `finish` **de fora** do contexto de
propósito — é o único que consegue notar a diferença.

## A rota é o padrão, não o endereço

`GET /orders/:id 200`, não `GET /orders/ord_7f3a91 200`. Senão cada id vira uma
rota e nenhum gráfico agrupa nada. Request que não casou com rota nenhuma vira
`unmatched`, não o caminho.

## O `x-request-id` que chega é conferido

Até 64 caracteres de `[A-Za-z0-9._:-]`. Qualquer outra coisa — `\r\n`, espaço,
`../`, tag de script — é descartada e um id novo é gerado. Esse valor volta num
header de resposta: aceitar o que veio seria deixar o cliente escrever header.

## `withErrorLog` não responde

Ele loga e chama `next(error)`. Decidir corpo e status da resposta de erro é do
app, não de um pacote de log — e se o nosso log falhar, o erro **continua**
indo para o próximo handler.
