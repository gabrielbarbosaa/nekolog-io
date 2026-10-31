# @apps/ingest

A API de ingestão: recebe lotes de log dos SDKs, valida contra a
[especificação 1](../../docs/ESPECIFICACOES.md) e entrega o lote adiante. Hono,
para rodar tanto em Cloudflare Workers quanto em Node.

```
POST /v1/logs      recebe o lote
GET  /health       responde se o processo está de pé
```

## O que esta etapa entrega, e o que não

A etapa 1.7 entrega a **camada HTTP**: rota, validação, limites de tamanho,
gzip e o formato estável de erro. Falta a 1.8 (keys, CORS, origens) e a 1.9
(gravação no ClickHouse).

Por isso **não existe um worker publicável ainda**, e isso é de propósito:
`createIngestApp` exige um autenticador e um destino. Não dá para montar um app
que aceite qualquer um ou que jogue log fora em silêncio — a assinatura não
permite.

```ts
const app = createIngestApp({
  authenticate: (request) => keyStore.check(request),
  sink: (batch, principal) => logStore.insert(rowsFor(batch, principal)),
  defer: (work) => ctx.waitUntil(work),
  onError: (error) => report(error),
})
```

`denyAll` existe para o caso em que ainda não há `KeyStore`: recusa tudo com
`invalid_key`. É o único padrão seguro.

## A ordem importa

A autenticação é resolvida **antes de o corpo ser lido**. Ler meio megabyte de
quem não provou nada é DoS de graça. Um lote enorme, malformado e sem key
responde `401`, não `413` — e tem teste para essa ordem, não só para os
códigos.

Depois vêm, nesta ordem: tipo de conteúdo, `Content-Length` declarado, leitura
com teto, descompressão com teto, UTF-8, JSON, esquema.

## Limites de tamanho

| Verificação | Por quê |
|---|---|
| `Content-Length` acima de 512 KB | recusa antes de ler qualquer byte |
| leitura com teto de 512 KB | o header pode mentir ou nem existir |
| descompressão com teto de 512 KB | **é aqui que mora a bomba de gzip** |

O terceiro é o que importa. Um gzip de 2 KB que vira 4 MB passa pelos dois
primeiros sem esforço. O teto é aplicado no fluxo **de saída** do
descompressor, e a leitura para no primeiro byte acima do limite em vez de
terminar de encher a memória — tem teste com um fluxo infinito, que só termina
porque a leitura corta. Ameaça D3 do
[modelo de ameaças](../../docs/security/threat-model.md).

## O corpo que ele aceita

`application/json` e `text/plain`. O segundo não é frescura: o `sendBeacon`
entre origens só manda tipos simples, sem preflight, então o corpo do browser
chega como texto contendo JSON.

Bytes que não são UTF-8 são **recusados**, não substituídos por `�`. Reescrever
o log de alguém em silêncio é pior do que dizer que ele veio quebrado.

## As respostas

```json
202 { "accepted": 49, "rejected": [{ "index": 3, "code": "invalid_level" }] }
400 { "error": { "code": "invalid_payload", "message": "…", "retryAfter": null } }
```

Um evento inválido **não derruba o lote**: os válidos entram, os inválidos
voltam com o índice e o código. Derrubar 500 eventos por causa de um é o tipo
de coisa que faz as pessoas desligarem o logging.

| Código | Status |
|---|---|
| `invalid_payload`, `unsupported_schema_version` | 400 |
| `invalid_key`, `secret_key_in_url` | 401 |
| `origin_not_allowed` | 403 |
| `payload_too_large` | 413 |
| `rate_limited`, `quota_exceeded` | 429 |

Um erro inesperado responde `500` com mensagem genérica. O `message` do erro
**nunca** vai para a resposta — ele pode carregar uma key, um caminho de
arquivo ou uma string de conexão. Vai para o `onError`, e tem teste que
procura o segredo no corpo da resposta.

## `/health` não consulta nada

É sinal de vida do processo, não do ClickHouse. Um health check que falha
quando o banco cai tira o Worker de rotação justamente quando ele ainda
conseguiria guardar o lote na contingência (R2) para reenviar depois.
Prontidão de dependência é outra coisa, e entra com a contingência na 1.11.

## O que o cliente não decide

`projectId` e `environmentId` vêm da key, pelo `principal`, nunca do corpo. Um
lote que mande esses campos é ignorado quanto a eles — tem teste que envia
`projectId: 'p_someone_else'` e confere que o que chegou ao destino foi o da
key.
