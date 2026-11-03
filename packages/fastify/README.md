# @nekolog-io/fastify

Plugin do NekoLog para Fastify: contexto por request, linha de acesso e log do
erro. O trabalho compartilhado com o Express e o Hono mora no
[`@nekolog-io/node`](../node/README.md).

```ts
import { nekologPlugin } from '@nekolog-io/fastify'

await app.register(nekologPlugin, { logger: log })
```

Três hooks: `onRequest` abre o contexto e responde com `traceparent` e
`x-request-id`, `onResponse` escreve a linha de acesso, `onError` loga o que o
handler jogou.

## O plugin não é encapsulado

Ele carrega `Symbol.for('skip-override')`. Sem isso, o Fastify encapsularia os
hooks no escopo do `register` e nada fora dele seria logado — que é
exatamente o contrário do que um plugin de log serve para fazer.

## O contexto atravessa o `done()`

O `onRequest` chama `done()` **de dentro** do `runWithContext`. É assim que o
`AsyncLocalStorage` acompanha o resto do ciclo da request; chamar `done()` por
fora faria o handler rodar sem contexto, e o `request.id` sumiria de tudo que
ele logasse. Tem teste com três requests simultâneas conferindo que os ids não
se misturam.

## A rota é o padrão

`request.routeOptions.url` no Fastify 4+, com `request.routerPath` como
alternativa para quem está atrás. Nada disso presente vira `unmatched`.

## Header que chegou duas vezes

O Node entrega um array quando o mesmo header vem repetido. `headerOf` pega o
primeiro e ignora o que não for texto — um `x-request-id` numérico não vira
string por conveniência.
