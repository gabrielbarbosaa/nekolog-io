---
title: Fastify
description: Um plugin, três hooks e o header que o browser precisa no CORS.
---

```bash
npm install @nekolog-io/fastify @nekolog-io/node
```

```ts
import Fastify from 'fastify'
import { createLogger, installProcessHooks } from '@nekolog-io/node'
import { nekologPlugin } from '@nekolog-io/fastify'

const log = createLogger({ service: 'checkout-api' })
installProcessHooks(log)

const app = Fastify()
await app.register(nekologPlugin, { logger: log })

app.get('/orders/:id', async (request) => {
  log.info('Pedido lido', { orderId: request.params.id })
  return { ok: true }
})
```

Três hooks: o `onRequest` abre o contexto e responde com `traceparent` e
`x-request-id`, o `onResponse` escreve a linha de acesso, o `onError` loga o que
o handler jogou.

| Opção | |
|---|---|
| `logger` | o logger, obrigatório |
| `accessLog: false` | mantém o contexto e o log de erro, tira a linha por resposta |
| `newRequestId` | o seu próprio gerador de id |

## O plugin não é encapsulado, de propósito

Ele carrega `Symbol.for('skip-override')`. Sem isso, o Fastify encapsularia os
hooks no escopo do `register` e nada fora dele seria logado — que é exatamente
o contrário do que um plugin de log serve para fazer.

Registre uma vez só, na raiz. Não precisa repetir dentro de cada plugin do seu
app.

## O contexto atravessa o `done()`

O `onRequest` chama `done()` **de dentro** do `runWithContext`. É assim que o
`AsyncLocalStorage` acompanha o resto do ciclo da request; chamar `done()` por
fora faria o handler rodar sem contexto, e o id da request sumiria de tudo que
ele logasse. Tem teste com três requests simultâneas conferindo que os ids não
se misturam.

## A rota é o padrão

`request.routeOptions.url` no Fastify 4+, com `request.routerPath` como
alternativa para versões mais antigas. Nada disso presente vira `unmatched`.

## Header que chegou duas vezes

O Node entrega um array quando o mesmo header vem repetido. O plugin pega o
primeiro e ignora o que não for texto — um `x-request-id` numérico não vira
string por conveniência.

## Liberando o `traceparent` no CORS

Um browser de outra origem mandando `traceparent` (que é o que
[o SDK de browser](/docs/pt-br/guides/browser/) faz para os alvos que você
configurar) dispara um preflight de CORS por causa desse header personalizado.
Libere:

```ts
import cors from '@fastify/cors'

await app.register(cors, {
  origin: 'https://shop.test',
  allowedHeaders: ['content-type', 'authorization', 'traceparent'],
  exposedHeaders: ['traceparent', 'x-request-id'],
})
```

O `allowedHeaders` deixa o header entrar; o `exposedHeaders` deixa a página ler
o `traceparent` e o `x-request-id` que voltam. Veja
[Trace distribuído](/docs/pt-br/guides/tracing/).
