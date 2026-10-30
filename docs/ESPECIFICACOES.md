# NekoLog — especificações técnicas

> Complementa o [PLANO.md](PLANO.md) e o [ETAPAS.md](ETAPAS.md). No repositório, cada especificação vira um arquivo em `docs/specs/` e muda só por PR. Versão 1, de 29/10/2026.

| # | Especificação | Usada nas etapas |
|---|---|---|
| 1 | Payload de ingestão v1 | 1.1, 1.7, 1.11, 3.1 |
| 2 | Variáveis de ambiente e segredos | 0.9, 0.10, 1.16, 1.18, 2.22 |
| 3 | Runner de migrations do ClickHouse | 1.2 |
| 4 | Linguagem de busca | 4.1 |
| 5 | Fingerprint de erros | 4.5 |
| 6 | Regras de alerta | 5.1, 5.2 |

---

## 1. Payload de ingestão v1

### Requisição

```http
POST /v1/logs
Authorization: Bearer nekolog_sk_…        (back-end)
POST /v1/logs?key=nekolog_pk_…            (browser)
Content-Type: application/json            (ou text/plain, ver abaixo)
Content-Encoding: gzip                    (opcional)
```

```json
{
  "schemaVersion": 1,
  "batchId": "01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10",
  "sdk": { "name": "@nekolog-io/browser", "version": "0.3.0" },
  "resource": { "service": "checkout-web", "release": "1.4.2", "runtime": "browser" },
  "events": [
    {
      "timestamp": "2026-10-29T14:03:12.481Z",
      "level": "error",
      "message": "Payment failed",
      "attributes": { "orderId": "123", "amount": 99.9, "retry": true },
      "trace": { "traceId": "4bf92f3577b34da6a3ce929d0e0e4736", "spanId": "00f067aa0ba902b7" },
      "session": { "id": "s_8f2k1", "userId": "u_42" },
      "error": { "type": "TypeError", "message": "Cannot read properties of undefined", "stack": "…" },
      "fingerprint": ["payment", "gateway-timeout"]
    }
  ]
}
```

### Campos

| Campo | Tipo | Obrigatório | Limites e regras |
|---|---|:-:|---|
| `schemaVersion` | inteiro | ✓ | `1`; o servidor aceita as duas últimas versões |
| `batchId` | UUID v7 | ✓ | gerado pelo SDK; usado para deduplicar reenvios |
| `sdk.name`, `sdk.version` | texto | ✓ | até 64 caracteres cada |
| `resource.service` | texto | | até 128; padrão `default` |
| `resource.release` | texto | | até 64 |
| `resource.runtime` | enum | ✓ | `browser`, `node`, `edge`, `bun`, `deno` |
| `events` | lista | ✓ | 1 a 500 eventos; lote de até 512 KB depois de descomprimido |
| `timestamp` | texto RFC 3339, UTC, ms | ✓ | horário do cliente |
| `level` | enum | ✓ | `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `message` | texto | ✓ | até 16 KB; acima disso, é cortado e marcado |
| `attributes` | objeto | | até 100 chaves; chave com até 128 caracteres (`[A-Za-z0-9_.-]`); valor texto, número, booleano ou `null`; texto com até 4 KB; objetos aninhados são achatados pelo SDK (`user.id`) |
| `trace.traceId`, `trace.spanId` | hex | | 32 e 16 caracteres (padrão W3C) |
| `session.id`, `session.userId` | texto | | até 64 e 128 caracteres |
| `error.type`, `error.message`, `error.stack` | texto | | até 256 caracteres, 4 KB e 32 KB |
| `fingerprint` | lista de textos | | até 5 itens; agrupamento manual de erros (especificação 5) |

### Regras

- **Nomes em camelCase** no JSON; as colunas do ClickHouse usam snake_case.
- **Campos desconhecidos são ignorados**, para SDKs mais novos funcionarem com servidores mais antigos dentro da mesma versão.
- **O servidor adiciona** `project_id` e `environment_id` (vindos da key), `received_at`, `country`, `fingerprint` (calculado) e `retention_days`.
- **Key:** a `nekolog_pk_` pode ir no header ou na URL; a `nekolog_sk_` só no header. Uma key secreta na URL é recusada, porque URLs aparecem em logs de proxies.
- **`text/plain` aceito:** o `sendBeacon` entre domínios só envia tipos simples, sem preflight, então o corpo pode vir como `text/plain` contendo JSON.
- **Evento inválido não derruba o lote:** os válidos são aceitos, e os inválidos voltam na resposta.

### Respostas

```json
202 Accepted
{ "accepted": 49, "rejected": [{ "index": 3, "code": "invalid_level" }] }
```

```json
400 / 401 / 403 / 413 / 429
{ "error": { "code": "payload_too_large", "message": "Batch exceeds 512 KB", "retryAfter": null } }
```

Códigos de erro estáveis (o SDK decide o que fazer por eles): `invalid_payload`, `unsupported_schema_version`, `invalid_key`, `secret_key_in_url`, `origin_not_allowed`, `payload_too_large`, `rate_limited`, `quota_exceeded`.

---

## 2. Variáveis de ambiente e segredos

Toda variável existe nos três ambientes (`dev`, `qa`, `prod`), com valores diferentes em cada um. Cada app valida as suas na inicialização com Valibot e não sobe se faltar alguma. O `.env.example` lista todas com valores falsos.

### Dashboard (`apps/web`, Vercel)

| Variável | Segredo | Para quê |
|---|:-:|---|
| `APP_ENV`, `APP_URL` | | ambiente e endereço público |
| `DATABASE_URL` | ✓ | Neon (branch do ambiente) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | ✓ | Redis; no self-host, `REDIS_URL` |
| `CLICKHOUSE_URL`, `CLICKHOUSE_DB` | | `https://ch.nekolog.io` e `nekolog_<ambiente>` |
| `CLICKHOUSE_READ_USER`, `CLICKHOUSE_READ_PASSWORD` | ✓ | usuário só com `SELECT` |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | ✓ | token de serviço do Access para chegar ao ClickHouse |
| `CF_ACCOUNT_ID`, `CF_KV_NAMESPACE_ID` | | KV das keys do ambiente |
| `CF_KV_API_TOKEN` | ✓ | token da API do Cloudflare que só escreve nesse namespace |
| `R2_ENDPOINT`, `R2_BUCKET` | | bucket do ambiente |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | ✓ | só nesse bucket (downloads de exportação e source maps) |
| `AUTH_JWT_PRIVATE_KEY`, `AUTH_JWT_PUBLIC_KEY`, `AUTH_JWT_KID` | ✓ | assinatura dos access tokens |
| `AUTH_JWT_PREVIOUS_PUBLIC_KEY` | | aceita a chave anterior durante uma rotação |
| `AUTH_OTP_SECRET` | ✓ | HMAC dos códigos |
| `ENCRYPTION_KEY` | ✓ | AES-256-GCM dos segredos guardados no banco |
| `RESEND_API_KEY` | ✓ | e-mail; no self-host, `SMTP_URL` |
| `EMAIL_FROM`, `EMAIL_ALLOWLIST` | | remetente; destinatários permitidos em `dev` e `qa` |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | — / ✓ | proteção contra bots |
| `NEKOLOG_SELF_KEY` | ✓ | logs do próprio NekoLog (dogfooding) |

### Ingestão (`apps/ingest`, Worker)

| Variável ou binding | Segredo | Para quê |
|---|:-:|---|
| `KEYS` (KV, só leitura) | | config das keys |
| `SPOOL` (R2) | | contingência |
| `CLICKHOUSE_URL`, `CLICKHOUSE_DB` | | destino dos logs |
| `CLICKHOUSE_INSERT_USER`, `CLICKHOUSE_INSERT_PASSWORD` | ✓ | usuário só com `INSERT` |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | ✓ | passar pelo Access |

### Jobs (`apps/jobs`, Worker)

| Variável ou binding | Segredo | Para quê |
|---|:-:|---|
| `KEYS` (KV, escrita) | | bloqueio por cota |
| `SPOOL`, `EXPORTS` (R2) | | reenvio e exportações |
| `DATABASE_URL` | ✓ | regras de alerta, cotas e agendamentos |
| `CLICKHOUSE_JOBS_USER`, `CLICKHOUSE_JOBS_PASSWORD` | ✓ | `SELECT`, `INSERT` (reenvio) e exportação para o R2 |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | ✓ | passar pelo Access |
| `RESEND_API_KEY`, `EMAIL_FROM` | ✓ / — | alertas e avisos de exportação |
| `BETTERSTACK_HEARTBEAT_URL` | ✓ | heartbeat a cada execução |
| `OPS_DISCORD_WEBHOOK_URL` | ✓ | alertas críticos para o operador |

As credenciais do R2 que o ClickHouse usa para gravar exportações ficam numa *named collection* configurada na VM, e não nas queries.

### CI e infraestrutura (GitHub Actions, por environment)

| Variável | Segredo | Para quê |
|---|:-:|---|
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | ✓ / — | deploy dos Workers e OpenTofu |
| `TOFU_STATE_PASSPHRASE` | ✓ | criptografia do estado do OpenTofu |
| `TOFU_STATE_R2_ACCESS_KEY_ID`, `TOFU_STATE_R2_SECRET_ACCESS_KEY` | ✓ | bucket do estado |
| `OCI_*` | ✓ | provider da Oracle |
| `VERCEL_API_TOKEN`, `GITHUB_ADMIN_TOKEN` | ✓ | providers da Vercel e do GitHub |
| `BACKUP_DATABASE_URL` | ✓ | papel do Postgres só de leitura, para o `pg_dump` |
| `BACKUP_AGE_RECIPIENT` | | chave **pública** do `age`; a chave privada fica offline, com o autor |
| `CLICKHOUSE_MIGRATOR_USER`, `CLICKHOUSE_MIGRATOR_PASSWORD` | ✓ | único usuário com DDL no ClickHouse; só o job de deploy o usa |

A publicação no npm não usa nenhum token: é feita por trusted publishing.

---

## 3. Runner de migrations do ClickHouse

- **Arquivos:** `internal/clickhouse/migrations/0001_create_logs.sql`, `0002_…`. **Um comando SQL por arquivo**, porque a API HTTP do ClickHouse executa um comando por requisição.
- **Controle:** tabela `_migrations (version UInt32, name String, checksum String, applied_at DateTime)`.
- **Execução:** aplica em ordem as migrations que ainda não estão em `_migrations` e grava o checksum de cada uma.
- **Proteção:** se o checksum de uma migration já aplicada mudar, o runner para com erro. Migration aplicada nunca é editada.
- **Só para frente:** não existe "down"; desfazer é uma migration nova.
- **Banco por ambiente:** `{{database}}` nos arquivos é trocado por `nekolog_dev`, `nekolog_qa` ou `nekolog_prod`.
- **Concorrência:** o ClickHouse não tem lock de migrations, então o runner só roda no job de deploy do CI, com um grupo de `concurrency` do GitHub Actions por ambiente.
- **Comandos:** `pnpm ch:migrate`, `pnpm ch:status` e `pnpm ch:new <nome>`.
- **Numeração sem buraco:** as versões começam em `0001` e não pulam nem repetem. Um buraco é quase sempre um arquivo perdido num merge, então o runner recusa o conjunto inteiro.
- **Nada fora de ordem:** se uma migration antiga está pendente e uma mais nova já foi aplicada, o runner para.
- **Nada some:** se o banco lembra de uma migration que não existe mais nos arquivos, o runner para.
- **O banco não é criado pelo runner:** se `CLICKHOUSE_DB` não existir, ele avisa e para. Criar o banco é provisionamento.
- **Checksum:** SHA-256 do arquivo **antes** da substituição de `{{database}}`, com `\r\n` normalizado para `\n`, para dar o mesmo valor em qualquer sistema operacional.

---

## 4. Linguagem de busca

### Exemplos

```
timeout                              palavra na mensagem
"payment failed"                     frase exata na mensagem
level:error service:api              campos (espaço = E)
level:(error OR fatal)               vários valores
service:api-*                        prefixo
-level:debug                         negação
@orderId:123                         atributo
@status>=500                         comparação numérica em atributo
(service:api OR service:web) -env:dev
```

### Gramática

```ebnf
query      = or_expr ;
or_expr    = and_expr { "OR" and_expr } ;
and_expr   = unary { [ "AND" ] unary } ;
unary      = [ "-" | "NOT" ] primary ;
primary    = "(" or_expr ")" | field_expr | term ;
field_expr = field ( ":" values | cmp_op number ) ;
field      = identifier | "@" attr_key ;
values     = value | "(" value { "OR" value } ")" ;
value      = word | phrase ;              (* word pode terminar em "*" *)
term       = word | phrase ;
cmp_op     = ">" | ">=" | "<" | "<=" ;
```

### Campos aceitos

`level`, `service`, `release`, `source`, `env`, `trace`, `span`, `session`, `user`, `issue` e atributos com `@`. Qualquer outro campo gera erro com a posição no texto.

### Tradução para SQL (sempre com parâmetros)

| Busca | SQL gerado |
|---|---|
| `level:error` | `level = {p1:String}` |
| `service:api-*` | `startsWith(service, {p2:String})` |
| `@orderId:123` | `attributes['orderId'] = {p3:String}` |
| `@status>=500` | `toFloat64OrNull(attributes['status']) >= {p4:Float64}` |
| `timeout` | `hasToken(lower(message), {p5:String})`, com o termo em minúsculas |
| `"payment failed"` | `positionCaseInsensitive(message, {p6:String}) > 0` |

- O índice da mensagem é sobre `lower(message)`, para a busca por palavra usar o índice sem diferenciar maiúsculas.
- O filtro de projeto, ambiente e período é sempre adicionado pelo servidor.
- **Limites:** até 1.000 caracteres, 20 condições e 5 níveis de parênteses.

---

## 5. Fingerprint de erros

Calculado na ingestão para eventos com `error` ou com nível `error` ou `fatal`. Primeira regra que se aplicar:

1. **Manual:** se o evento traz `fingerprint`, usa esses textos.
2. **Stack trace:** `error.type` mais os 5 primeiros frames do próprio app, normalizados:
   - ignora frames de `node_modules`, do runtime e de extensões do navegador;
   - remove números de linha e coluna, query string e hash do nome dos arquivos (`main.3f2a1c.js` → `main.js`);
   - em arquivos minificados, ignora o nome da função, porque ele muda a cada build.
3. **Mensagem:** `error.type` mais a mensagem normalizada: números → `<n>`, UUIDs → `<uuid>`, hex longos → `<hex>`, e-mails → `<email>`, URLs → só o caminho, textos entre aspas → `<str>`.
4. **Log de erro sem `error`:** serviço mais a mensagem normalizada.

- O resultado são os 8 primeiros bytes do SHA-256 dessas partes, gravados como `UInt64`.
- Uma issue é a combinação de projeto e fingerprint, com contagem por ambiente.
- O algoritmo tem versão (`fingerprint_v1`). Mudá-lo cria uma versão nova, para issues antigas não se misturarem com novas.
- É a versão 1: os testes usam stacks reais de Chrome, Firefox, Safari e Node, e o algoritmo é revisto no M4 com dados de verdade.

---

## 6. Regras de alerta

Cada regra é guardada em `alert_rules.condition` (JSON) e avaliada pelos jobs a cada minuto.

```json
{
  "type": "threshold",
  "query": "level:error service:api",
  "environment": "production",
  "window": "5m",
  "operator": ">",
  "value": 50,
  "cooldown": "30m",
  "channels": ["ch_01J9X…"]
}
```

| Tipo | Dispara quando |
|---|---|
| `threshold` | a contagem de logs da busca na janela passa do valor |
| `error_rate` | a porcentagem de `error` + `fatal` na janela passa do valor, com um volume mínimo (`minEvents`) para evitar ruído |
| `new_issue` | aparece uma issue nova no ambiente |
| `issue_regression` | uma issue resolvida volta a acontecer |
| `absence` | nenhum log da busca chega durante a janela (por exemplo, um serviço que parou de mandar logs) |

- **Janelas:** `1m`, `5m`, `15m` e `1h`.
- **Estados:** `ok` → `firing` → `resolved`. Quando o alerta se resolve, a pessoa também é avisada. O `cooldown` evita repetir o aviso.
- **Conteúdo do aviso:** nome da regra, ambiente, valor medido e limite, e um link para o Explorer já com a busca e o período, no idioma de quem recebe.
- **Webhooks** levam o header `X-NekoLog-Signature` (HMAC-SHA256 do corpo com um segredo por canal), para quem recebe confirmar que veio do NekoLog.
- **Limite do Worker gratuito:** cada execução pode fazer no máximo 50 subrequests. Por isso os jobs agrupam todas as regras do mesmo tipo e ambiente numa única query ao ClickHouse e, se houver muitas regras, processam em lotes que se revezam a cada minuto.
- **Instância hospedada:** até 20 regras por projeto, ajustável pelo operador.
