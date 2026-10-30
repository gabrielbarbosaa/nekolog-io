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

A etapa 1.3 é o **logger**. O envio ainda não existe: o transporte em lote, o
retry com backoff e o `flush()` de verdade chegam na 1.4; amostragem,
`beforeSend` e remoção de dados sensíveis, na 1.5.

Por isso, sem um `sink`, o logger escreve no `console`. É a única opção honesta
hoje — não existe para onde mandar. Quando a 1.4 chegar, um logger criado com
`apiKey` vai usar o transporte em lote, e o `console` volta a ser o que é: um
`sink` entre outros. A opção `apiKey` já existe na assinatura para a API
pública não mudar de forma, mas **hoje ela não é usada**.

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
