---
title: Node.js
description: Contexto por request, hooks de processo e as variáveis de ambiente que o SDK lê.
---

:::caution[Ainda não está no npm]
Os pacotes `@nekolog-io/*` ainda não foram publicados. Esta página descreve o
comportamento que o código já tem, para a forma da API ficar clara.
:::

```bash
npm install @nekolog-io/node
```

```ts
import { createLogger, installProcessHooks } from '@nekolog-io/node'

const log = createLogger({ service: 'checkout-api', release: '1.4.2' })
installProcessHooks(log)

log.info('Pedido criado', { orderId: 123 })
await log.flush()
```

Este é o pacote em que toda integração de servidor se apoia —
[Express](/docs/pt-br/guides/express/), [Fastify](/docs/pt-br/guides/fastify/),
[Hono](/docs/pt-br/guides/hono/), [NestJS](/docs/pt-br/guides/nestjs/) e a
metade de servidor do [Next.js](/docs/pt-br/guides/next/) usam todos ele.

## Variáveis de ambiente

Sem opção explícita, estas valem:

| Variável | Para quê |
|---|---|
| `NEKOLOG_KEY` | a key; ela já define projeto e ambiente |
| `NEKOLOG_ENDPOINT` | outro destino, para self-host |
| `NEKOLOG_SERVICE` | o nome do serviço |
| `NEKOLOG_RELEASE` | a versão publicada |
| `NEKOLOG_LEVEL` | o nível mínimo |

O que você passa em código ganha da variável. Variável em branco é tratada como
ausente, não como string vazia, e um `NEKOLOG_LEVEL` que não existe é
**ignorado e avisado** pelo `onError` em vez de derrubar o logger.

## Contexto por request

O `runWithContext` prende um contexto ao ramo assíncrono inteiro. O logger lê
esse contexto **a cada chamada**, então ele não precisa ser recriado por
request, nem passado adiante:

```ts
runWithContext({ attributes: { requestId }, trace }, async () => {
  await handle()
})
```

| | |
|---|---|
| `runWithContext(ctx, fn)` | roda `fn` com `ctx` somado ao que já valia |
| `addContext(ctx)` | acrescenta ao escopo que já está rodando; devolve `false` se não houver nenhum |
| `bindContext(ctx, fn)` | devolve `fn` com o contexto grudado, para callback que roda depois |
| `currentContext()` | o contexto que vale agora, ou `undefined` |

Escopos aninhados **somam**, e o de dentro ganha em chave repetida. O que você
passa na chamada (`log.child(...)` ou o segundo argumento) ganha do contexto
ambiente — ambiente é pano de fundo, não ordem.

O `addContext` só alcança o escopo atual e os que nascerem dele. Ele **não**
volta para fora: descobrir o `userId` no meio de uma request não deveria vazar
para a request seguinte.

Requests simultâneas não se misturam, e tem teste com três requests
intercaladas de propósito.

### Um listener não herda o contexto

Um listener de evento roda no contexto que estiver ativo quando o evento sai —
numa resposta com backpressure, o do socket, não o da request. Embrulhe:

```ts
response.on('finish', bindContext(currentContext(), escreve))
```

## Hooks de processo

Criar o logger não mexe no `process`. Quem mexe é esta chamada, explicitamente —
porque trocar o comportamento de saída de um processo pelas costas de quem
instalou o pacote é como se ganha um processo zumbi em produção.

```ts
const uninstall = installProcessHooks(log, {
  signals: ['SIGTERM'],
  flushTimeoutMs: 5000,
})
```

| Evento | O que acontece |
|---|---|
| `uncaughtException` | escreve o erro no stderr, loga como `fatal`, dá flush, **e aí sim encerra com 1** |
| `unhandledRejection` | o mesmo |
| `SIGTERM`, `SIGINT` | dá flush e então deixa o sinal fazer o que ia fazer |
| `beforeExit` | dá flush uma vez, e sai do caminho |

Três coisas que valem mais do que a tabela:

- **O comportamento padrão do Node é preservado.** Instalar um listener de
  `uncaughtException` faz o Node parar de derrubar o processo — é assim que um
  serviço vira zumbi segurando conexão. Então o stack continua indo para o
  stderr, e o processo continua encerrando com 1. `exitOnFatal: false` desliga,
  se você quiser mesmo.
- **Se o app já trata, o SDK não decide.** Com outro listener de
  `uncaughtException` registrado, não encerramos — quem registrou tem um plano.
  Com outro listener de `SIGTERM` (desligamento gracioso), damos flush e saímos
  do caminho.
- **O flush tem prazo.** O `flushTimeoutMs` (2 s por padrão) impede que uma rede
  travada segure o encerramento para sempre. Rede caindo não pode virar deploy
  travado.

## Serverless

`await log.flush()` antes de devolver a resposta é **obrigatório** onde o
processo pode ser congelado ou morto logo depois de o handler retornar.

## Chamadas que saem

`installTracePropagation({ targets })` soma o header `traceparent` do W3C às
chamadas que o seu serviço faz. O `targets` é obrigatório e não tem padrão —
veja [Trace distribuído](/docs/pt-br/guides/tracing/).
