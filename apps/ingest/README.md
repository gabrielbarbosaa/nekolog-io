# @apps/ingest

A API de ingestão: recebe lotes de log dos SDKs, valida contra a
[especificação 1](../../docs/ESPECIFICACOES.md) e entrega o lote adiante. Hono,
para rodar tanto em Cloudflare Workers quanto em Node.

```
POST /v1/logs      recebe o lote
GET  /health       responde se o processo está de pé
```

## O que esta etapa entrega, e o que não

As etapas 1.7 e 1.8 entregam a **camada HTTP** (rota, validação, limites de
tamanho, gzip, formato de erro) e as **keys** (autenticação, origens, CORS).
Falta a 1.9: gravação no ClickHouse.

```ts
const app = createIngestApp({
  authenticate: createKeyAuthenticator({
    keyStore: cachedKeyStore(kvKeyStore(env.KEYS)),
  }),
  sink: (batch, principal) => logStore.insert(rowsFor(batch, principal)),
  defer: (work) => ctx.waitUntil(work),
  onError: (error) => report(error),
})
```

`createIngestApp` exige um autenticador e um destino. Não dá para montar um app
que aceite qualquer um ou que jogue log fora em silêncio — a assinatura não
permite. `denyAll` existe para quem ainda não tem `KeyStore`: recusa tudo com
`invalid_key`.

## Keys

Duas formas de mandar a key, e elas não são intercambiáveis:

| Onde | Quem usa | Qual key |
|---|---|---|
| `Authorization: Bearer …` | back-end | `nekolog_sk_` ou `nekolog_pk_` |
| `?key=…` | browser, via `sendBeacon` | **só** `nekolog_pk_` |

Uma `sk` na query é recusada com `secret_key_in_url` **antes de qualquer
consulta** — nem o hash dela é calculado. URL aparece em log de proxy, em
histórico e em referer, então uma key secreta que passou por ali já deve ser
considerada vazada.

Isso vale **mesmo que o header traga uma key boa**. A query é conferida
primeiro de propósito: a `sk` já vazou para o log do proxy, e aceitar a request
porque o header estava certo só esconderia o problema de quem precisa saber.

A busca é **pelo hash SHA-256**, nunca pela key. A key em claro não chega ao
armazenamento, e é por isso que ela aparece uma vez só, na criação
(ADR [0006](../../docs/adr/0006-keys-por-ambiente.md)).

Depois da key vêm, nesta ordem: escopo `logs:write`, bloqueio por cota
(`quota_exceeded`) e origem.

### Origens permitidas

Valem **só para key pública** — é ela que fica visível no código do site. Uma
key secreta é responsabilidade de quem a guarda, e um header `Origin` numa
chamada de servidor não quer dizer nada.

| Lista | O que acontece |
|---|---|
| `null` | qualquer origem |
| `[]` | nenhuma |
| `['https://app.example.com']` | exata, sem diferenciar maiúsculas |
| `['https://*.example.com']` | qualquer subdomínio |
| `['*']` | qualquer origem, explicitamente |

Com lista configurada, **request sem `Origin` é recusado**. Sem isso a lista não
protegeria nada: quem copia a `pk` do seu site manda por `curl`, sem `Origin`
nenhum.

O curinga confere esquema e sufixo de verdade: `https://*.example.com` aceita
`a.example.com` e `a.b.example.com`, e recusa `example.com`, `aexample.com`,
`app.example.com.attacker.test` e `http://app.example.com`. É o erro clássico
de CORS, e tem teste para cada um desses casos.

Porta faz parte da origem: `*.example.com` não casa `a.example.com:3000`.

## CORS

O preflight responde `204` e ecoa a origem que perguntou. Ele **não decide
nada** — quem decide é o POST, que é autenticado e passa pela lista. Recusar o
preflight só trocaria um `403 origin_not_allowed` legível por um erro de rede
opaco no console de quem está integrando.

`Access-Control-Allow-Credentials` nunca é enviado. Esta API não tem cookie
para proteger, e ecoar origem com credenciais ligadas é exatamente o buraco que
se abre sem querer.

Os erros também levam os headers de CORS. Sem isso o SDK de browser veria falha
de rede em vez de `invalid_key`, e ficaria tentando de novo para sempre em vez
de parar.

`traceparent` e `tracestate` estão liberados, que é o que permite o trace sair
do front e continuar no back (PLANO seção 8).

## Cache das keys

`cachedKeyStore` segura a resposta do KV por 60 s na memória do Worker, e
guarda também a **ausência** — key inválida não vira consulta a cada request.
Escrever ou apagar pelo próprio cache invalida na hora.

O custo está no ADR 0006: **revogação leva até ~60 s** para valer em todo
lugar. É o preço de não depender do KV no caminho quente.

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
| `quota_exceeded` | 429 |
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
