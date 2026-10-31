# @nekolog-io/core

Núcleo do SDK do NekoLog: níveis, `child()`, contexto, remoção de dados
sensíveis, amostragem, envio em lote e a montagem do evento no formato que a
ingestão aceita. **Zero dependências**, roda em browser, Node, Bun, Deno e edge.

```ts
import { createLogger } from '@nekolog-io/core'

const log = createLogger({ service: 'checkout-web', release: '1.4.2' })

log.info('Pedido criado', { orderId: 123 })
log.child({ attributes: { requestId } }).error(err, { step: 'pagamento' })

await log.flush()
```

## O que esta etapa entrega, e o que não

As etapas 1.3, 1.4 e 1.5 entregam o **logger**, o **transporte** e o
**pipeline de privacidade**. O pacote está completo.

Com `apiKey`, o logger usa o transporte em lote. Sem `apiKey` e sem `sink`, ele
escreve no `console`.

Compressão gzip do corpo ainda não é feita — a API aceita, mas é opcional, e
entra junto com o SDK de browser.

## Transporte

```ts
const log = createLogger({
  apiKey: process.env.NEKOLOG_KEY,
  service: 'core-service',
  transport: { flushIntervalMs: 2000, maxQueueEvents: 5000 },
})

await log.flush()
```

Os eventos entram numa fila e saem em lote: quando a fila atinge o tamanho do
lote, quando o timer dispara, ou quando alguém chama `flush()`. Em serverless,
`flush()` antes de devolver a resposta é obrigatório.

A key vai no header `Authorization: Bearer`, **nunca na URL** — URL aparece em
log de proxy, e a própria API recusa uma key secreta na query. Tem teste para
isso.

### O lote

| Regra | Valor |
|---|---|
| eventos por lote | no máximo 500 |
| tamanho do lote | no máximo 512 KB |
| fila | 1.000 eventos por padrão |

Um lote grande demais é partido ao meio até caber, sem perder nem reordenar
evento. Um evento que sozinho não cabe é descartado e **contado** — `onDrop`
recebe `('event_too_large')`, porque perder log em silêncio é pior do que
perder log.

O `batchId` é um UUID v7 gerado sem dependência, e é o **mesmo em todas as
tentativas** do mesmo lote. É isso que deixa o servidor deduplicar um reenvio.

Fila cheia descarta o **mais antigo**: o que importa num incidente é o estado
agora. Os descartes são contados em `transport.dropped` e avisados pelo
`onDrop`.

### Retry

Exponencial com *jitter*, começando em 500 ms, teto de 30 s, 5 tentativas.
Repete em 5xx, 408, 429 e falha de rede.

O `Retry-After` é respeitado ao pé da letra, em segundos ou em data HTTP.
**Se o servidor pedir mais do que o teto do backoff**, o transporte não
espera bloqueando nem volta antes da hora: ele guarda os eventos, se declara
pausado até aquele instante e não manda mais nada até lá. Pedir 300 s por cota
estourada e receber uma tentativa em 30 s é exatamente o que o servidor queria
evitar.

### Quando ele desiste de vez

Alguns erros não mudam de ideia com insistência: `invalid_key`,
`origin_not_allowed`, `secret_key_in_url` e `unsupported_schema_version`. Neles
o transporte **para**, esvazia a fila, avisa pelo `onError` e passa a descartar
o que chegar. Ficar martelando uma key inválida só gera ruído e custo.

Já `invalid_payload` e `payload_too_large` descartam **aquele lote** e seguem.
E eventos recusados dentro de um lote aceito (`202` com `rejected`) chegam no
`onReject`, sem reenviar o lote.

## O que sai antes de o evento existir

Todo evento passa por **amostragem → `beforeSend` → remoção**, nessa ordem, e
isso vale para qualquer `sink` — inclusive o `console`, porque a senha também
não deveria aparecer no terminal de quem desenvolve. O porquê da ordem está no
ADR [0014](../../docs/adr/0014-ordem-do-pipeline-de-privacidade-do-sdk.md).

### Remoção de dados sensíveis

Ligada por padrão. Nada precisa ser configurado.

Por **chave**, em qualquer segmento do caminho achatado — `user.password`,
`headers.authorization`, `card.cvv`, `customer.cpf`, `apiKey`, `set-cookie`,
`sessionId`, e as variações deles, já que a comparação ignora maiúsculas,
`_`, `-` e `.`. Como a comparação é por conteúdo, `passwordHash` também sai.

Por **valor**, dentro de qualquer texto — mensagem, `error.message`,
`error.stack` e atributos de texto:

| O quê | Como é reconhecido |
|---|---|
| par `chave=valor` | a chave é sensível pela **mesma lista** usada nos atributos |
| número de cartão | 13 a 19 dígitos **validados por Luhn** |
| CPF | formatado ou não, pelos **dois dígitos verificadores** |
| JWT | três segmentos base64url começando em `eyJ` |
| `Authorization` | `Bearer …` e `Basic …`, mantendo o esquema |
| credencial em URL | `https://user:senha@host` |
| key do NekoLog | `nekolog_sk_…`, mantendo o prefixo |

A validação é o ponto: um regex de 16 dígitos apagaria todo id de pedido do seu
log. Com Luhn, `4111111111111111` sai e `4111111111111112` fica.

O par `chave=valor` cobre o caso mais comum de vazamento acidental, que é
segredo que caiu no meio de uma string em vez de virar atributo:

| Entra | Sai |
|---|---|
| `POST /login?token=abc123&user=ana` | `POST /login?token=[redacted]&user=ana` |
| `{"password":"hunter2"}` | `{"password":[redacted]}` |
| `authorization: Bearer abc.def` | `authorization: [redacted]` |
| `user=ana orderId=42` | igual — nenhuma chave é sensível |

A lista de chaves é **a mesma** dos atributos, então `extraKeys` e `skipKeys`
valem aqui também. O valor termina no primeiro espaço, vírgula, `;`, `&`, `)`,
`}` ou `]` — é o que separa `?token=abc&user=ana` certo.

```ts
createLogger({
  privacy: {
    extraKeys: ['prontuario'],
    extraPatterns: [/INT-\d+/],
    skipKeys: ['tokenCount'],
  },
})
```

`skipKeys` existe porque a busca por conteúdo erra para o lado de remover:
`tokenCount` casa com `token`. Tirar uma chave exata do caminho não desarma o
resto da lista.

`privacy: { scrubText: false }` mantém só a remoção por chave, se as cinco
varreduras de regex por evento pesarem. `privacy: { enabled: false }` desliga
tudo.

O texto varrido costuma vir de fora — corpo de request, header, erro de
terceiro. Nenhum dos padrões tem quantificador aninhado, e as classes de
caractere excluem o delimitador que vem depois delas, que é o que impede
retrocesso catastrófico. Sete entradas hostis de 16 KB levam menos de 1 ms, e
isso está num teste. Se você passar um `extraPatterns` seu, a conta é sua: um
regex que trava, trava o app de quem usa o SDK.

### Amostragem

```ts
createLogger({ sampling: { rate: 0.1 } })
```

Duas coisas que ela **não** faz:

- **Não quebra uma request ao meio.** Com `trace.traceId` no contexto, a decisão
  vem de um hash do trace, não de um sorteio: ou todos os logs daquela request
  entram, ou nenhum. Meia request no dashboard não ajuda ninguém a depurar.
- **Não descarta erro.** O piso `sampling.alwaysFrom` começa em `error`, então
  `rate: 0.01` vale para `info` e deixa `error` e `fatal` passarem inteiros.
  Alerta e issue contam erro — se a amostragem pudesse derrubá-los em silêncio,
  toda contagem precisaria dividir pela taxa. Quem quiser amostrar erro também
  passa `alwaysFrom: false`.

### `beforeSend`

```ts
createLogger({
  beforeSend(event) {
    if (event.attributes?.route === '/health') return null
    return { ...event, message: `[checkout] ${event.message}` }
  },
})
```

Recebe o evento **cru**, antes da remoção, e devolve o evento, ou `null` para
descartar. Três comportamentos que valem conhecer:

- **Ele não desfaz a remoção.** O que ele devolve ainda passa pelo filtro. É de
  propósito: a garantia de privacidade não pode depender do gancho estar certo.
- **O que ele devolve é revalidado** contra o contrato da ingestão — nível,
  timestamp, tamanho da mensagem, atributos, trace, sessão, fingerprint. Um
  gancho não consegue produzir um evento que a API recusaria.
- **Esquecer o `return` descarta o log**, como no Sentry. Para o engano não ser
  silencioso, o SDK avisa uma vez pelo `onError` dizendo exatamente isso. Se ele
  lançar, aquele evento é descartado em vez de ir cru — é onde a PII ia sair.

## Níveis

`trace`, `debug`, `info`, `warn`, `error`, `fatal`, nessa ordem. O padrão é
`info`. `setLevel()` vale para o logger e para todos os filhos dele, porque o
limiar é compartilhado — mudar o nível em produção não deveria depender de
alcançar cada filho criado por request.

Um nível desconhecido é **ignorado**, não aceito: `setLevel('verbose')` avisa
pelo `onError` e mantém o nível anterior.

## `child()` e contexto

O filho herda o contexto do pai e acrescenta ao dele:

| Parte | Como combina |
|---|---|
| `attributes` | mescla; em chave repetida, o filho ganha |
| `trace` | substitui — um `traceId` com o `spanId` de outro trace não faz sentido |
| `session` | mescla `id` e `userId` separadamente |
| `fingerprint` | substitui; é uma decisão de agrupamento, não um acúmulo |

O pai nunca é alterado por um filho.

### Contexto ambiente

`contextProvider` é um gancho lido **a cada log**, não capturado uma vez. É o
que permite a um SDK de plataforma injetar contexto sem o logger ser recriado
por request — o `@nekolog-io/node` liga o `AsyncLocalStorage` nele.

```ts
createLogger({ contextProvider: () => currentRequestContext() })
```

O contexto ambiente fica **embaixo** do contexto do logger: o que você passou em
`child()` ou na chamada ganha. Se o provider lançar, o log vai assim mesmo, sem
o contexto, e o `onError` fica sabendo — perder o `requestId` é ruim, perder o
log é pior.

## O evento que ele monta

Segue a [especificação 1](../../docs/ESPECIFICACOES.md). O SDK já entrega
dentro dos limites, então a ingestão não precisa cortar nada:

- `timestamp` em RFC 3339 UTC com milissegundos
- `message` cortada em 16 KB **contando bytes UTF-8**, nunca vazia
- `attributes` achatados em chaves com ponto (`user.id`), com as chaves
  saneadas para `[A-Za-z0-9_.-]`, valores de texto cortados em 4 KB e no máximo
  100 chaves
- `trace` só vai se o par estiver no formato W3C; um `traceId` malformado é
  descartado em vez de virar uma rejeição na API
- `error` extraído de um `Error`, com `type`, `message` e `stack` cortados

Isso não é confiança no papel: `src/contract.test.ts` roda os eventos que este
pacote produz pelo **parser real da ingestão** (`@internal/schema`) e exige zero
rejeições, inclusive nos casos limite — e inclusive quando um `beforeSend`
hostil devolve um evento fora do contrato, ou quando a remoção deixa o texto
maior do que era (`Bearer x` vira `Bearer [redacted]`). E compara, uma a uma, as constantes de
limite dos dois pacotes — se a ingestão mudar um limite e o SDK não, o teste
quebra.

As constantes vivem duplicadas aqui de propósito: o pacote tem que ir para o
npm **sem dependências**, e `@internal/schema` usa Valibot. O teste de contrato
é o que paga por essa duplicação.

## Como se comportam os atributos

Achatar dados do host é onde um logger costuma explodir. As regras:

| Entrada | Vira |
|---|---|
| objeto, array | achatado com ponto (`user.id`, `tags.0`) |
| `Date` | string ISO |
| `bigint` | string, porque JSON não carrega bigint |
| `NaN`, `Infinity` | string, porque o contrato pede número finito |
| `Error` | `.name` e `.message` — **nunca** o stack, grande demais para atributo |
| referência cíclica | `'[Circular]'` |
| getter que lança | `'[unreadable]'`, e o resto do log continua |
| `undefined`, função, símbolo | descartado |
| instância de classe | achatada se não tiver `toString` próprio; senão, o `toString()` |

## Nunca lança no app que o usa

Esta é a regra mais importante do SDK. Toda entrada pública é envolvida: se o
`sink` lança, se o relógio lança, se um getter de atributo lança, se o próprio
`onError` lança — o app não vê nada. O `onError` padrão escreve um aviso no
console; dá para trocar ou silenciar.

Vale igualmente para o transporte: rede caindo, corpo que não é JSON, `onDrop`
que lança, runtime sem `fetch`. Nada disso sobe para o app.

Os testes provam isso quebrando cada uma dessas peças de propósito.

## Build

`tsdown` gera ESM, CJS e os tipos. O `tsconfig.json` liga
**`isolatedDeclarations`**, e é por isso que constantes exportadas com valor
calculado têm anotação explícita (`export const MAX_MESSAGE_BYTES: number = 16 * 1024`).

O motivo é concreto: o repositório usa **TypeScript 7**, que não expõe mais a
API clássica que o gerador de `.d.ts` do `tsdown` usava. Com
`isolatedDeclarations`, os tipos são gerados pelo Oxc, que não precisa dela. A
alternativa era voltar para o TypeScript 6 no repositório inteiro — mais caro, e
na direção errada. O custo aceito é a anotação explícita, que num pacote
publicado é disciplina boa de qualquer forma.

`pnpm --filter @nekolog-io/core lint` roda `publint` e
`@arethetypeswrong/cli`, que conferem o `exports` para consumidores em CJS,
ESM, `node10`, `node16` e bundler.
