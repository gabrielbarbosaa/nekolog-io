# @nekolog-io/hono

Middleware do NekoLog para Hono: contexto por request, linha de acesso e log do
que o handler jogou. O trabalho compartilhado com o Express e o Fastify mora no
[`@nekolog-io/node`](../node/README.md).

```ts
import { nekolog } from '@nekolog-io/hono'

app.use('*', nekolog(log))
```

Um middleware só faz as três coisas, porque no Hono tudo acontece em volta do
mesmo `await next()`.

## A linha sai mesmo quando o `next()` rejeita

O `record()` está num `finally`. Se um middleware mais abaixo levantar, a
request ainda ganha a sua linha de acesso — e o erro **continua subindo**, não
é engolido.

O Hono trata o erro do handler internamente e devolve 500, então esse caminho
não aparece num teste via `app.request()`. Tem teste chamando o middleware
direto com um `next` que rejeita, que é o único jeito de notar.

## A rota é o padrão

`c.req.routePath` quando existe, e o caminho quando o Hono casou com `/*` —
senão todo request não casado viraria a mesma rota. Nada casado mesmo vira
`unmatched`.

## Runtime

Depende do `@nekolog-io/node`, que usa `AsyncLocalStorage` do
`node:async_hooks`. Isso existe no Node, no Bun, no Deno e no Cloudflare
Workers (com `nodejs_compat`). Não existe num browser, mas um middleware de
servidor não roda lá.
