---
title: Express
description: Contexto por request, uma linha de acesso por resposta e o header que o browser precisa no CORS.
---

:::caution[Ainda não está no npm]
Os pacotes `@nekolog-io/*` ainda não foram publicados. Esta página descreve o
comportamento que o código já tem, para a forma da API ficar clara.
:::

```bash
npm install @nekolog-io/express @nekolog-io/node
```

```ts
import express from 'express'
import { createLogger, installProcessHooks } from '@nekolog-io/node'
import { withAccessLog, withErrorLog, withLogContext } from '@nekolog-io/express'

const log = createLogger({ service: 'checkout-api' })
installProcessHooks(log)

const app = express()

app.use(withLogContext())
app.use(withAccessLog(log))

app.get('/orders/:id', (request, response) => {
  log.info('Pedido lido', { orderId: request.params.id })
  response.json({ ok: true })
})

app.use(withErrorLog(log))
```

**A ordem importa.** O `withLogContext` abre o escopo, então vem primeiro; o
`withErrorLog` é um handler de erro, então vem depois das rotas.

| | |
|---|---|
| `withLogContext()` | lê o `traceparent` e o `x-request-id`, responde com os dois e prende o contexto na request |
| `withAccessLog(log)` | uma linha por resposta, com método, rota, status e duração |
| `withErrorLog(log)` | loga o erro e **passa adiante** — quem responde é o seu handler |

## A rota é o padrão, não o endereço

`GET /orders/:id 200`, nunca `GET /orders/ord_7f3a91 200`. Senão cada id vira
uma rota e nenhum gráfico agrupa nada. Request que não casou com rota nenhuma
vira `unmatched`, não o caminho.

## O `x-request-id` que chega é conferido

Até 64 caracteres de `[A-Za-z0-9._:-]`. Qualquer outra coisa — `\r\n`, espaço,
`../`, tag de script — é descartada e um id novo é gerado. Esse valor volta num
header de resposta: aceitar o que veio seria deixar o cliente escrever header.

## O `withErrorLog` não responde

Ele loga e chama `next(error)`. Decidir corpo e status da resposta de erro é do
app, não de um pacote de log — e se o nosso log falhar, o erro **continua**
indo para o próximo handler.

## Liberando o `traceparent` no CORS

Se um browser de outra origem mandar `traceparent` (que é o que
[o SDK de browser](/docs/pt-br/guides/browser/) faz para os alvos que você
configurar), esse header personalizado dispara um preflight de CORS. A sua API
precisa liberar, senão a request falha antes de começar:

```ts
import cors from 'cors'

app.use(
  cors({
    origin: 'https://shop.test',
    allowedHeaders: ['content-type', 'authorization', 'traceparent'],
    exposedHeaders: ['traceparent', 'x-request-id'],
  }),
)
```

O `allowedHeaders` é o que deixa a request levar o header **para dentro**; o
`exposedHeaders` é o que deixa a página ler o `traceparent` e o `x-request-id`
que voltam — útil quando você quer mostrar um id de request numa tela de erro.
Veja [Trace distribuído](/docs/pt-br/guides/tracing/).

## O ouvinte do `finish` é amarrado ao contexto

Isso está no pacote, não é coisa que você escreve, mas vale saber por que a
linha de acesso ainda leva o que a rota acrescentou com `addContext`: um
listener de evento **não** herda o `AsyncLocalStorage` de quem o registrou. Ele
roda no contexto que estiver ativo quando o evento sai, que numa resposta com
backpressure é o do socket. Por isso o `finish` vai embrulhado em `bindContext`.
