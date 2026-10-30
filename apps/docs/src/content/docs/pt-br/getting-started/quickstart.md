---
title: Primeiros passos
description: Envie seu primeiro log de uma aplicação Node.js.
---

:::caution[Ainda não disponível]
Os pacotes `@nekolog-io/*` ainda não foram publicados no npm, então os comandos
desta página ainda não funcionam. Eles estão aqui para deixar clara a forma da
API enquanto ela é construída.
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

- [Introdução](/docs/pt-br/getting-started/introduction/) — como as peças se
  encaixam e o que é open source.
