# @nekolog-io/core

Núcleo do SDK do NekoLog: níveis, `child()`, contexto e a montagem do evento no
formato que a ingestão aceita. **Zero dependências**, roda em browser, Node,
Bun, Deno e edge.

```ts
import { createLogger } from '@nekolog-io/core'

const log = createLogger({ service: 'checkout-web', release: '1.4.2' })

log.info('Pedido criado', { orderId: 123 })
log.child({ attributes: { requestId } }).error(err, { step: 'pagamento' })

await log.flush()
```

## O que esta etapa entrega, e o que não

As etapas 1.3 e 1.4 entregam o **logger** e o **transporte**. Falta a 1.5:
amostragem, `beforeSend` e remoção de dados sensíveis.

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
rejeições, inclusive nos casos limite. E compara, uma a uma, as constantes de
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
