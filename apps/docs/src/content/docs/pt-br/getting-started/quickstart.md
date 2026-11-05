---
title: Primeiros passos
description: Envie seu primeiro log de uma aplicação Node.js.
---

:::caution[Você precisa de um convite antes]
Os pacotes `@nekolog-io/*` não são públicos. Seu convite traz as credenciais do
registro e as keys do seu primeiro projeto; configure os dois antes de os
comandos abaixo funcionarem.
:::

## Instalação

```bash
npm install @nekolog-io/node
```

## Enviando um log

```ts
import { createLogger } from '@nekolog-io/node'

const log = createLogger({
  apiKey: process.env.NEKOLOG_KEY!, // a key já identifica projeto + ambiente
  service: 'checkout-api',
  release: '1.4.2',
})

log.info('Pedido criado', { orderId: 123 })
log.child({ requestId }).error(err, { step: 'pagamento' })

await log.flush() // importante em serverless, onde o processo pode encerrar antes
```

## O que esperar

- Os logs são enviados em lotes, com gzip, retry e backoff. Uma falha no envio
  nunca quebra a sua aplicação.
- O `flush()` espera tudo que está na fila ser entregue. Chame antes de uma
  função serverless retornar, ou no encerramento do processo.
- Dados sensíveis (`password`, `token`, `authorization`, `cpf`, números de
  cartão) são removidos por padrão, antes de qualquer coisa sair do seu processo.

## Próximos passos

- [`nekolog init`](/docs/pt-br/guides/cli/) — um comando que detecta o
  framework, instala o SDK certo e escreve o `.env`.
- [Plugin de bundler](/docs/pt-br/guides/bundler-plugin/) — registra a release e
  sobe os source maps de dentro do seu build Vite, webpack, Rollup ou esbuild.
- O guia da sua stack: [Browser](/docs/pt-br/guides/browser/),
  [React](/docs/pt-br/guides/react/), [Next.js](/docs/pt-br/guides/next/),
  [Node.js](/docs/pt-br/guides/node/), [Express](/docs/pt-br/guides/express/),
  [Fastify](/docs/pt-br/guides/fastify/), [Hono](/docs/pt-br/guides/hono/),
  [NestJS](/docs/pt-br/guides/nestjs/), [pino](/docs/pt-br/guides/pino/) ou
  [winston](/docs/pt-br/guides/winston/).
- [Trace distribuído](/docs/pt-br/guides/tracing/) — uma linha do tempo só entre
  o front e o back, e o header que isso exige no CORS.
- [Alertas](/docs/pt-br/guides/alerts/) — os cinco tipos de regra, e como
  conferir que um webhook veio mesmo do NekoLog.
- [A API pública](/docs/pt-br/api/reference/) e a
  [linguagem de busca](/docs/pt-br/api/search/) — leia por conta própria tudo
  que o dashboard mostra. Já usa OpenTelemetry? Tem
  [endpoint OTLP](/docs/pt-br/api/otlp/).
- [O que fica guardado](/docs/pt-br/reference/privacy/) — o que nunca sai do seu
  processo, o que o servidor remove, e o que nunca é gravado.
- [Versionamento e suporte](/docs/pt-br/reference/versioning/) — o que uma
  mudança promete, e por quanto tempo uma versão antiga continua funcionando.
- [Introdução](/docs/pt-br/getting-started/introduction/) — como as peças se
  encaixam e o que você recebe.
