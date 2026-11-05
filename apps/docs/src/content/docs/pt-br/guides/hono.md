---
title: Hono
description: Um middleware, qualquer runtime e o header que o browser precisa no CORS.
---

```bash
npm install @nekolog-io/hono @nekolog-io/node
```

```ts
import { Hono } from 'hono'
import { createLogger } from '@nekolog-io/node'
import { nekolog } from '@nekolog-io/hono'

const log = createLogger({ service: 'checkout-api' })

const app = new Hono()
app.use('*', nekolog(log))

app.get('/orders/:id', (c) => {
  log.info('Pedido lido', { orderId: c.req.param('id') })
  return c.json({ ok: true })
})
```

Um middleware só faz as três coisas, porque no Hono tudo acontece em volta do
mesmo `await next()`.

| Opção | |
|---|---|
| `accessLog: false` | mantém o contexto, tira a linha por resposta |
| `newRequestId` | o seu próprio gerador de id |

## A linha sai mesmo quando o `next()` rejeita

O `record()` está num `finally`. Se um middleware mais abaixo levantar, a
request ainda ganha a sua linha de acesso — e o erro **continua subindo**, não é
engolido.

O Hono trata o erro do handler internamente e devolve 500, então esse caminho
não aparece num teste via `app.request()`. Tem teste chamando o middleware
direto com um `next` que rejeita, que é o único jeito de notar.

## A rota é o padrão

`c.req.routePath` quando existe, e o caminho quando o Hono casou com `/*` —
senão todo request não casado viraria a mesma rota. Nada casado mesmo vira
`unmatched`.

## Runtimes

O middleware depende do `@nekolog-io/node`, que usa `AsyncLocalStorage` do
`node:async_hooks`. Isso existe no Node, no Bun, no Deno e no Cloudflare Workers
(com `nodejs_compat`). Não existe num browser, mas um middleware de servidor não
roda lá.

Nos Workers, lembre que o isolate pode ser congelado assim que a resposta sai.
Dê flush antes de responder, ou entregue a promise para o `waitUntil`:

```ts
app.use('*', async (c, next) => {
  await next()
  c.executionCtx.waitUntil(log.flush())
})
```

## Liberando o `traceparent` no CORS

Um browser de outra origem mandando `traceparent` (que é o que
[o SDK de browser](/docs/pt-br/guides/browser/) faz para os alvos que você
configurar) dispara um preflight de CORS por causa desse header personalizado.
Libere:

```ts
import { cors } from 'hono/cors'

app.use(
  '*',
  cors({
    origin: 'https://shop.test',
    allowHeaders: ['content-type', 'authorization', 'traceparent'],
    exposeHeaders: ['traceparent', 'x-request-id'],
  }),
)
```

O `allowHeaders` deixa o header entrar; o `exposeHeaders` deixa a página ler o
`traceparent` e o `x-request-id` que voltam. Veja
[Trace distribuído](/docs/pt-br/guides/tracing/).
