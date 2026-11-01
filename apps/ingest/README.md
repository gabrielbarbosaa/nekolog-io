# @apps/ingest

A API de ingestão: recebe lotes de log dos SDKs, valida contra a
[especificação 1](../../docs/ESPECIFICACOES.md) e entrega o lote adiante. Hono,
para rodar tanto em Cloudflare Workers quanto em Node.

```
POST /v1/logs      recebe o lote
GET  /health       responde se o processo está de pé
```

## O que esta etapa entrega, e o que não

As etapas 1.7 a 1.12 entregam a **camada HTTP**, as **keys**, a **gravação no
ClickHouse**, a **contingência** e os **limites**. O caminho completo existe:
`log.info()` no SDK vira linha na tabela.

Falta o deploy (1.18).

```ts
export default {
  fetch(request, env, ctx) {
    return buildIngestApp(assertEnv(env)).fetch(request, env, ctx)
  },
}
```

`createIngestApp` exige um autenticador e um destino. Não dá para montar um app
que aceite qualquer um ou que jogue log fora em silêncio — a assinatura não
permite. `denyAll` existe para quem ainda não tem `KeyStore`: recusa tudo com
`invalid_key`.

`assertEnv` recusa um Worker sem binding e **diz todos os que faltam de uma
vez**, em vez de o primeiro request morrer com `undefined is not a function`.

## Rodando localmente, sem Cloudflare

```bash
pnpm seed init                     # cria as keys, uma vez
pnpm --filter @apps/ingest serve   # ingestão em :8787
```

O `serve` é a mesma aplicação do Worker, com as peças que não existem fora da
Cloudflare trocadas por equivalentes locais: as keys saem do `.nekolog-seed.json`
em vez do KV, e **não há contingência** — se o ClickHouse recusar, o erro aparece
no stderr em vez de ir para um bucket. É de propósito: em desenvolvimento, falha
guardada em silêncio é falha que você descobre tarde.

Ele recusa subir sem o arquivo de seed e sem ClickHouse respondendo, dizendo qual
dos dois falta. `startLocalIngest` é o mesmo caminho, exportado, e é o que o
`examples/express` usa no teste de ponta a ponta.

Escuta em `127.0.0.1`, não em `0.0.0.0`. Ele carrega as keys do seed em memória e
fala com um ClickHouse de desenvolvimento sem TLS — nada disso deveria ficar
alcançável pela rede da sua casa ou do café.

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

Depois da key vêm, nesta ordem: escopo `logs:write`, revogação manual, bloqueio
por cota (`quota_exceeded`) e origem.

A `blocked` do registro da key é a **revogação manual**, decidida pelo
dashboard. O bloqueio por cota é uma lista separada no KV, escrita pelos jobs.
Duas decisões diferentes, de donos diferentes, com a mesma resposta ao cliente.

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

## Rate limit e cota

São dois freios diferentes, e só o segundo é uma garantia.

**O rate limit é por ambiente e por instância do Worker.** O Cloudflare roda
vários *isolates*, cada um com seu contador, então o teto real é o configurado
vezes o número de instâncias. Ele serve para segurar rajada e proteger o
ClickHouse de um pico — não para controlar volume. Quem controla volume é a
cota diária.

Ele **conta eventos, não requests**, e é consultado depois da validação: um
request traz até 500 eventos, e um limite por request não teria relação nenhuma
com o que de fato é gravado. O lote recusado não é cobrado, e um lote maior que
a janela inteira nunca passa — por isso o limite tem que ser confortavelmente
maior que 500.

Quando o limitador em si falha, a ingestão **continua aceitando** e o erro vai
para o `onError`. Derrubar a ingestão porque o freio quebrou troca um problema
de custo por um de perda de dados.

**A cota diária vem do KV**, escrita pelo `quota-block` do `apps/jobs`. A
ingestão só lê, com cache de 60 s por isolate — mesmo caminho do cache das
keys, mesmo atraso de ~60 s para valer. Se a leitura falhar, vale **a última
lista que deu certo**; só quando nunca houve uma é que o tráfego passa.

O `Retry-After` de uma recusa por cota é de 60 s, não "até a meia-noite UTC". O
bloqueio pode cair a qualquer minuto (o operador sobe a cota, o dia vira), e
mandar um cliente dormir por horas com base no nosso relógio erraria feio
quando ele voltasse antes.

## Limite de atributos por projeto

No máximo 500 chaves distintas em `attributes` por projeto. Passando disso, a
**chave nova é descartada** e o evento é gravado do mesmo jeito — perder a linha
inteira por causa de um atributo seria o pior dos dois mundos. O que isso
protege é a coluna `Map(LowCardinality(String), String)` do ClickHouse, que
degrada quando a cardinalidade das chaves cresce sem limite.

Isso é um **teto por isolate**, não um número global: um isolate novo reaprende
as primeiras 500 chaves que vê. Ele limita o estrago de uma integração que gera
chave dinâmica (`user_42`, `user_43`…); não é uma garantia de 500 no banco. A
lista por projeto no KV, que tornaria o teto exato, depende do dashboard saber
quais chaves existem — fica para quando houver dashboard.

O registro em si também é limitado: 50 projetos por isolate, o mais antigo sai
quando chega um novo. Esse número não é estético — ele é o que mantém o pior
caso dentro da memória de um Worker. Com 500 chaves de até 128 caracteres por
projeto, 50 projetos dão uns 8 MB; 200 dariam uns 33 MB, que é muito para um
limite de 128 MB compartilhado com todo o resto. Tem teste fazendo essa conta.

O atributo `error.message` que a própria ingestão acrescenta **não gasta
orçamento**: ele é nosso, é um só, e não é por ele que a cardinalidade cresce.

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

## A gravação

O `202` sai assim que o lote é validado. A escrita vai para o `waitUntil` do
Worker, então uma ida ao ClickHouse não entra no tempo de resposta do SDK. Fora
de um Worker — self-host em Node, teste — não há `waitUntil`, e aí a escrita é
esperada mesmo; o app descobre isso sozinho pelo contexto do Hono.

Um erro na escrita **não muda o `202`**. O lote já foi aceito.

### Quando o ClickHouse recusa: a contingência

O lote vai para o bucket `SPOOL` no R2, com as linhas já mapeadas e o mesmo
token de deduplicação que o insert teria usado. O `spool-resend` do `apps/jobs`
reenvia no minuto seguinte, e o token garante que nada entre duas vezes. O
formato está em [`@internal/spool`](../../internal/spool/README.md).

O `onError` só é chamado quando **as duas** coisas falham — ClickHouse e R2 —, e
aí a mensagem traz as duas causas, porque "falhou a gravação" sem dizer que a
contingência também caiu manda o operador para o lado errado. Quando o lote é
guardado, sai um aviso dizendo qual arquivo e quantas linhas.

O binding `SPOOL` é **obrigatório**: sem ele o Worker não sobe. Subir sem a
contingência é rodar com uma promessa de durabilidade a menos sem ninguém
perceber (ameaça D6).

### O que o servidor carimba

| Coluna | De onde vem |
|---|---|
| `project_id`, `environment_id` | da **key**, nunca do corpo |
| `received_at` | do servidor, o mesmo para o lote inteiro |
| `country` | do `CF-IPCountry`, validado como duas letras |
| `retention_days` | da configuração do ambiente |
| `fingerprint` | `0` por enquanto — quem calcula é a etapa 4.5 |

**Nenhum header de IP é lido em lugar nenhum.** Só o país. Tem teste que manda
`CF-Connecting-IP` e `X-Forwarded-For` e confere que o endereço não aparece na
linha gravada (ameaça I6).

O `error.message` que difere da `message` do log vai para o atributo
`error.message` em vez de sumir — a tabela não tem coluna para ele, e descartar
dado do cliente em silêncio é pior do que guardá-lo num lugar previsível.

As colunas que a linha escreve são conferidas **contra a própria migration**:
`rows.test.ts` lê `0001_create_logs.sql` e exige que o conjunto bata. Renomear
uma coluna sem ajustar o mapeamento quebra o teste.

### `async_insert`, e por que ele espera

O insert usa `async_insert=1` com **`wait_for_async_insert=1`**. O primeiro dá
o agrupamento que o ClickHouse precisa para não sofrer com lote pequeno; o
segundo mantém a garantia de que a linha foi gravada.

Não esperar seria tentador — mas estamos dentro do `waitUntil`, depois do
`202`, então a latência não custa nada ao cliente, e sem a espera uma falha
viraria silêncio. A contingência da 1.11 depende de saber que falhou.

O token de deduplicação é `<environmentId>:<batchId>`. É isso que torna o
reenvio da contingência seguro: o mesmo lote duas vezes grava uma vez só. Tem
teste contra o ClickHouse de verdade, mandando o mesmo lote duas vezes e
contando. O ambiente entra no token porque o `batchId` é escolhido pelo cliente
e a deduplicação do ClickHouse é por partição, compartilhada entre projetos —
ver [`@internal/spool`](../../internal/spool/README.md).

### Drift de schema não passa em silêncio

`input_format_skip_unknown_fields=0`. Sem isso o ClickHouse **aceita** uma
linha com coluna que não existe, grava o resto com defaults e devolve sucesso —
foi o que aconteceu quando testei contra o servidor de verdade. Com a opção, um
descompasso entre código e tabela falha alto.

O custo: durante um deploy, migration tem que vir antes do código que usa a
coluna nova. É a ordem que o runner forward-only já impõe.

## `/health` não consulta nada

É sinal de vida do processo, não do ClickHouse. Um health check que falha
quando o banco cai tira o Worker de rotação justamente quando ele ainda
conseguiria guardar o lote na contingência (R2) para reenviar depois.
Prontidão de dependência é outra coisa.

## O que o cliente não decide

`projectId` e `environmentId` vêm da key, pelo `principal`, nunca do corpo. Um
lote que mande esses campos é ignorado quanto a eles — tem teste que envia
`projectId: 'p_someone_else'` e confere que o que chegou ao destino foi o da
key.
