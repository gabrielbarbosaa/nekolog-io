# @internal/schema

Contrato do payload de ingestão entre os SDKs e `apps/ingest`. Implementa a
**especificação 1** do [ESPECIFICACOES.md](../../docs/ESPECIFICACOES.md); a spec
é a fonte da verdade, este pacote é a implementação dela.

```ts
import { parseBatch } from '@internal/schema'

const result = parseBatch(await request.json())

if (!result.ok) {
  return respondWithError(result.code, result.message)
}

const { accepted, rejected } = result.batch
```

## Um evento inválido não derruba o lote

A regra mais importante da spec, e a que mais molda o desenho. Um
`v.parse(payloadInteiro)` recusaria tudo por causa de um evento ruim, então:

- **O envelope** (`schemaVersion`, `batchId`, `sdk`, `resource`, tamanho da
  lista) é validado de forma estrita. Falhou, o lote inteiro é recusado.
- **Cada evento** é validado em separado. Os válidos seguem em `accepted`, os
  inválidos voltam em `rejected` com o índice original e um código.

O índice é o da posição no array recebido, para o SDK conseguir correlacionar
com o que enviou.

## Caracteres e bytes não são a mesma coisa

A spec alterna entre as duas unidades de propósito, e o código honra a
distinção:

| Campo | Limite |
|---|---|
| `sdk.name`, `sdk.version`, `resource.release` | 64 **caracteres** |
| `resource.service`, `session.userId`, chave de atributo | 128 **caracteres** |
| `session.id` | 64 **caracteres** |
| `error.type` | 256 **caracteres** |
| `message` | 16 **KB** |
| valor de atributo (texto), `error.message` | 4 **KB** |
| `error.stack` | 32 **KB** |

Os limites em bytes usam `utf8ByteLength`, não `String.length`: `'é'` ocupa dois
bytes e um emoji ocupa quatro.

## Por que UTF-8 em JavaScript puro

`utf8.ts` calcula tamanho e trunca sem usar `TextEncoder`/`TextDecoder`. Não é
preciosismo: este pacote roda no SDK de browser, em Node, em Workers, Bun e
Deno, e `tsconfig.base.json` usa `lib: ES2022`, que não declara esses globais.
A alternativa seria incluir a lib `DOM`, o que faria `document` passar a existir
para o type-checker num pacote que nunca deve tocar o DOM.

De quebra, trabalhar no nível de code point em vez de fatiar bytes faz com que
o truncamento **nunca parta um caractere no meio** — incluindo pares surrogados
de emoji. Há um teste que verifica isso contra o `TextEncoder` em todos os
limites de 0 ao tamanho da string.

Essa garantia é sustentada pelo build, não pela disciplina: `tsconfig.json` usa
`types: []` e exclui os testes, então o **fonte** nem enxerga `TextEncoder`.
Quem tentar usá-lo quebra o typecheck. Os testes rodam por
`tsconfig.test.json`, que acrescenta os tipos do Node — eles *precisam* do
`TextEncoder` justamente para servir de referência independente.

## Mensagem longa é cortada, não recusada

A spec diz que `message` acima de 16 KB "é cortado e marcado". O corte acontece
aqui; a **marcação** é exposta como `messageTruncated: true` no evento aceito.

A spec não define como a marcação deve aparecer para quem lê o log, e o schema
do ClickHouse (seção 7 do plano) não tem coluna para isso. A decisão de como
tornar isso visível fica para `apps/ingest` (etapa 1.7) — este pacote só reporta
o fato.

## Códigos

- `BATCH_ERROR_CODES` — recusa do lote inteiro. São os códigos estáveis da spec,
  que o SDK usa para decidir se vale retentar.
- `EVENT_REJECTION_CODES` — recusa de um evento, no formato `invalid_<campo>`,
  como no exemplo `invalid_level` da spec.

## O que não está aqui

- **Limite de 512 KB do corpo**: `exceedsBatchSizeLimit()` existe, mas medir o
  corpo descomprimido é responsabilidade de `apps/ingest`.
- **Campos que o servidor adiciona** (`project_id`, `environment_id`,
  `received_at`, `country`, `fingerprint`, `retention_days`): não fazem parte do
  contrato com o SDK.
- **Validação de key, origem, cota e rate limit**: tudo isso é da ingestão.
