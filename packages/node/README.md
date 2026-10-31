# @nekolog-io/node

SDK do NekoLog para Node: tudo do [`@nekolog-io/core`](../core/README.md) mais
contexto por request com `AsyncLocalStorage`, captura de `uncaughtException` e
`unhandledRejection`, e flush no `SIGTERM`.

```ts
import { createLogger, installProcessHooks, runWithContext } from '@nekolog-io/node'

const log = createLogger({ service: 'checkout-api' })
installProcessHooks(log)

app.use((req, res, next) =>
  runWithContext({ attributes: { requestId: req.id } }, next),
)

log.info('Pedido criado', { orderId: 123 })
```

## Contexto por request

`runWithContext` prende um contexto ao ramo assíncrono inteiro. O logger lê
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
ambiente — o ambiente é pano de fundo, não ordem.

`addContext` só alcança o escopo atual e os que nascerem dele. Ele **não** volta
para o escopo de fora: descobrir o `userId` no meio de uma request não deveria
vazar para a request seguinte.

Requests simultâneas não se misturam, e isso tem teste com três requests
intercaladas de propósito.

## `installProcessHooks`

Criar o logger não mexe no `process`. Quem mexe é esta chamada, explicitamente —
porque trocar o comportamento de saída de um processo pelas costas de quem
instalou o pacote é como se ganha um processo zumbi em produção.

```ts
const uninstall = installProcessHooks(log)
```

O que ela instala, e o que cada um faz:

| Evento | O que acontece |
|---|---|
| `uncaughtException` | escreve o erro no stderr, loga como `fatal`, dá flush, **e aí sim encerra com 1** |
| `unhandledRejection` | o mesmo |
| `SIGTERM`, `SIGINT` | dá flush e então deixa o sinal fazer o que ia fazer |
| `beforeExit` | dá flush uma vez, e sai do caminho |

Três cuidados que valem mais do que a lista:

- **O comportamento padrão do Node é preservado.** Instalar um listener de
  `uncaughtException` faz o Node parar de derrubar o processo — é assim que um
  serviço vira zumbi segurando conexão. Então o stack continua indo para o
  stderr, e o processo continua encerrando com 1. `exitOnFatal: false` desliga,
  se você quiser mesmo.
- **Se o app já trata, o SDK não decide.** Com outro listener de
  `uncaughtException` registrado, não encerramos — quem registrou tem um plano.
  Com outro listener de `SIGTERM` (desligamento gracioso), damos flush e saímos
  do caminho, sem matar o processo por baixo dele.
- **O flush tem prazo.** `flushTimeoutMs` (2 s por padrão) impede que uma rede
  travada segure o encerramento para sempre. Rede caindo não pode virar deploy
  travado.

`installProcessHooks` devolve a função que desfaz tudo.

```ts
installProcessHooks(log, {
  signals: ['SIGTERM'],
  flushTimeoutMs: 5000,
  unhandledRejection: false,
})
```

Isso não é confiança no papel: os testes **sobem processos Node de verdade** e
conferem o código de saída, o stderr e se o flush terminou antes de o processo
morrer — inclusive um controle que roda sem os hooks, para provar que o Node
já se comportava assim.

## Ambiente

Sem opção explícita, estas variáveis valem:

| Variável | Para quê |
|---|---|
| `NEKOLOG_KEY` | a key; ela já define projeto e ambiente |
| `NEKOLOG_ENDPOINT` | outro destino, para self-host |
| `NEKOLOG_SERVICE` | nome do serviço |
| `NEKOLOG_RELEASE` | versão publicada |
| `NEKOLOG_LEVEL` | nível mínimo |

O que você passa em código ganha da variável. Variável em branco é tratada como
ausente, não como string vazia. Um `NEKOLOG_LEVEL` que não existe é **ignorado
e avisado** pelo `onError`, em vez de derrubar o logger.

## O resto

Níveis, `child()`, remoção de dados sensíveis, amostragem, `beforeSend`, envio
em lote e `flush()` vêm do `@nekolog-io/core` e estão documentados
[lá](../core/README.md). Este pacote só acrescenta o que depende do Node.

`await log.flush()` antes de devolver a resposta continua obrigatório em
serverless.
