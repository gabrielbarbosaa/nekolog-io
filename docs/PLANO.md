# NekoLog — plano do projeto

> Plataforma de logs proprietária · site `nekolog.io` · GitHub `nekolog-io` (privado) · Atualizado em 05/11/2026
>
> Documentos: [ETAPAS.md](ETAPAS.md) (ordem de execução) · [ESPECIFICACOES.md](ESPECIFICACOES.md) (contratos técnicos) · [COMERCIAL.md](COMERCIAL.md) (o que falta para cobrar)

Uma plataforma de logs para aplicações JavaScript/TypeScript, no front-end e no back-end: SDKs em npm, uma API que recebe os logs, armazenamento analítico e um dashboard com filtros, gráficos e projetos, com keys separadas por ambiente.

É um produto **proprietário**, de um autor só, com todos os direitos reservados — ADR [0017](adr/0017-licenca-proprietaria-e-repositorio-privado.md). Tudo vive num repositório privado só, `nekolog-io`: os SDKs, a ingestão, os jobs, a API pública de leitura, o site, a documentação e o dashboard — ADR [0019](adr/0019-um-repositorio-so.md). **Tudo roda numa máquina só**, uma VPS, e a instância é por convite.

> **Duas revisões recentes, para quem leu este documento antes.** Em 04/11/2026 o
> produto deixou de ser open-core (tabela A de [COMERCIAL.md](COMERCIAL.md)), e
> em 05/11/2026 a plataforma deixou de ser Cloudflare Workers, Workers KV, R2,
> Tunnel, Access, VM da Oracle, Neon, Upstash e Vercel — tudo isso foi removido
> pelo item D4 sem nunca ter sido aplicado. As seções 4, 5, 14, 15, 17, 18 e 19
> já descrevem a máquina que existe, e os [`docs/runbooks/`](runbooks/README.md)
> também, desde 05/11/2026 — mas **nenhum deles foi executado**, porque a
> máquina ainda não foi comprada (item B1). São procedimento derivado do que o
> código faz, não passo a passo testado.

---

## 1. Decisões tomadas

> As decisões arquiteturais desta tabela têm um ADR em [docs/adr/](adr/README.md)
> com o contexto completo, as alternativas descartadas e as consequências
> aceitas. Esta tabela é o resumo; o ADR é o aprofundamento.

| Tema | Decisão | Motivo |
|---|---|---|
| Nome | NekoLog: site `nekolog.io`, escopo `@nekolog-io` no npm, org `nekolog-io` no GitHub | `@nekolog` e `nekolog` já estavam ocupados; o mesmo nome nos três lugares |
| Modelo | Produto proprietário, de um autor só | Decidido em 04/11/2026: o que dá o produto não é a visibilidade do repositório, é a licença — ADR [0017](adr/0017-licenca-proprietaria-e-repositorio-privado.md) |
| Repositórios | Um, privado: `nekolog-io`, com o dashboard dentro, em `apps/dashboard` | A divisão existia porque este era público sob MIT; a [0017](adr/0017-licenca-proprietaria-e-repositorio-privado.md) removeu o motivo e a [0019](adr/0019-um-repositorio-so.md) removeu a divisão |
| Código comum aos dois | `adapters`, `clickhouse`, `config` e `db` ficam em `packages/` como `@nekolog-io/*` | O dashboard escreve no mesmo Postgres; duplicar essa definição é a única divergência que nenhum teste dos dois lados consegue pegar (ADR [0016](adr/0016-pacotes-compartilhados-no-npm.md)) |
| Escopo | Plano completo até a 1.0, executado em marcos | Evita retrabalho de arquitetura depois do MVP |
| Hospedagem | Uma VPS, mais o domínio e um bucket de backup | Decidido em 05/11/2026: a camada gratuita da nuvem não sustenta um produto pago, e espalhar por cinco fornecedores custava mais operação do que uma máquina |
| Logs | ClickHouse na própria máquina | Banco colunar, rápido em agregações; o ClickHouse Cloud só tem trial |
| Metadados | Postgres na própria máquina | — |
| Ingestão | Hono em Node, num container | Um único jeito de rodar, e é o que é testado |
| Keys | Por ambiente, públicas (`pk`) e secretas (`sk`) | A key define o ambiente; o SDK não precisa informar |
| Autenticação | Módulo próprio (`internal/auth`), sem Better Auth | O Better Auth não tem refresh token com rotação e não gera código alfanumérico no 2FA |
| Login | E-mail + senha + código alfanumérico de 6 caracteres por e-mail, em todo login | Segundo fator obrigatório |
| Códigos e sessões | Redis (Valkey na própria máquina) | Dados temporários; o TTL faz a limpeza |
| Sessão | Access token JWT de 10 min + refresh token que muda a cada uso, com detecção de reuso | Pedido explícito; detecta token copiado |
| Tema visual | Paleta Grafite, com tema claro e escuro | Interface neutra deixa a cor para os níveis de log |
| Instância hospedada | Só por convite, com Turnstile, cotas e área do operador | Protege as cotas gratuitas e evita responder por dados de qualquer pessoa |
| Idiomas | Dashboard, docs, e-mails e README em português (pt-BR), inglês e espanhol; código, commits, branches e PRs em inglês | Alcance internacional e diferencial para a comunidade latina |
| Segurança | Prioridade máxima em todas as camadas (seção 14) | A plataforma recebe dados de terceiros e publica pacotes que rodam em outras aplicações |
| Versionamento | Tudo versionado: pacotes, apps, API, payload, migrations e docs (seção 16) | Atualizações previsíveis para quem usa e para quem hospeda |
| Branches | `main` (produção), `qa` (homologação) e `dev` (desenvolvimento), com uma branch por etapa (seção 17) | Histórico organizado e promoção controlada entre ambientes |
| Licença | Proprietária, todos os direitos reservados, com uma concessão estreita para usar os SDKs dentro da aplicação do cliente | Sem a concessão o produto não é vendável; sem a licença, qualquer um sobe uma cópia e cobra por ela (ADR [0017](adr/0017-licenca-proprietaria-e-repositorio-privado.md)) |
| Infraestrutura | Como código, com OpenTofu, no que é de fornecedor: o repositório, o domínio de e-mail e os nomes da máquina (seção 15.5) | Tudo recriável, versionado e revisado em PR; o que roda dentro da máquina é compose, não OpenTofu |
| Acompanhamento | Cada etapa é uma issue no GitHub, dentro do milestone do seu marco | Cada PR fecha uma issue; o histórico fica rastreável |
| Cotas da instância hospedada | 10 mil eventos por dia por organização e retenção de 7 dias, ajustáveis pelo operador; projetos e membros sem limite | Cabe nas cotas gratuitas e pode crescer depois |
| Exportação de logs | JSON, XML e CSV, manual ou agendada, avisada por e-mail com link autenticado | Guardar logs além da retenção sem expor dados por e-mail |
| Papéis | 4 papéis fixos por organização: owner, admin, member e viewer (seção 10.2) | Simples de entender, de implementar e de testar |
| Telas | Mapa de telas no plano (seção 10.1); mockups HTML aprovados antes do M2 | Decidir navegação e fluxo antes de programar |
| Ferramentas | Gráficos com ECharts, validação com Valibot, migrations do ClickHouse com runner próprio e monitor externo Better Stack | Desempenho com muitos pontos, leveza no caminho quente, simplicidade e heartbeat com página de status |

## 2. Decisões em aberto

- **Em aberto de verdade, e com relógio:** comprar a VPS (item B1 de [COMERCIAL.md](COMERCIAL.md)), escolher o modelo de cobrança (tabela C) e decidir se os pacotes compartilhados vão para o npm sob a licença nova ou saem do npm e o dashboard os consome por git.
- **Logo e ícone:** o autor vai criar e adicionar depois; até lá, o projeto usa o nome em texto.
- **Mockups das telas:** aprovação antes das telas do dashboard. A etapa 2.1 está feita, em `docs/ui-mockups/`.

**Decididas em 03/11/2026, antes do M2:**

- **Compartilhamento de código:** deixou de ser um problema. A ADR [0016](adr/0016-pacotes-compartilhados-no-npm.md) tirou `adapters`, `clickhouse`, `config` e `db` de `internal/` e os publicou no npm **porque o dashboard estava noutro repositório**; a [0019](adr/0019-um-repositorio-so.md) o trouxe para cá e os quatro voltaram a ser privados. Ao npm vão treze pacotes: os doze SDKs e o `@nekolog-io/core`. O `internal/auth` (senhas, OTP, JWT, sessões) nasce aqui, junto do resto.
- **Divisão do M2:** feita no [ETAPAS.md](ETAPAS.md) em 03/11 e desfeita em 06/11. As etapas de dashboard, autenticação e interface voltaram a ter caixa, com o número preservado — as issues delas nunca foram fechadas.

---

## 3. Princípios

1. **Ingestão sem I/O, processamento pesado fora dela.** A API valida, calcula o que sai do próprio evento e grava. O que precisa de rede ou de banco — resolver source map, avaliar regra de alerta, montar issue — roda nos jobs. O `fingerprint` é a exceção que confirma a regra: ele é CPU pura sobre o evento que já está em mãos (especificação 5), e o ClickHouse não preenche coluna depois do insert sem uma *mutation*, que é cara e assíncrona.
2. **Todo comportamento de fornecedor fica atrás de uma interface** (`KeyStore`, `RateLimiter`, `BlobStore`, `Mailer`, `LogStore`, `RedisClient`). Era para rodar o mesmo código na nuvem e numa máquina; acabou sendo o que permitiu **trocar a plataforma inteira** em 05/11/2026 escrevendo implementações novas e apagando as antigas, sem tocar na aplicação.
3. **O SDK nunca quebra a aplicação** e não tem dependências.
4. **Padrões abertos:** formato de log do OpenTelemetry e propagação via `traceparent` (W3C).
5. **Privacidade por padrão (LGPD):** dados sensíveis são removidos no SDK e no servidor; o IP não é guardado, só o país.

---

## 4. Arquitetura

```
SDKs (browser / node)
   │ HTTPS, lotes com gzip
   ▼
Cloudflare Free ....... DNS, TLS na borda, proteção contra ataque
   │
   ▼
┌─ a máquina ─────────────────────────────────────────────────────┐
│ Caddy (80/443) ── o único que publica porta                     │
│   ├─ ingest.<domínio> ──► ingest     (Hono em Node)             │
│   ├─ api.<domínio> ─────► api        (leitura pública)          │
│   ├─ <domínio>/docs ────► docs       (Astro estático)           │
│   └─ <domínio> ─────────► web        (Next em standalone)       │
│                                                                 │
│ jobs ◄─ agendador próprio, a cada minuto                        │
│   ├─ alertas, issues, uso, cotas                                │
│   └─► Resend / Discord / webhook                                │
│                                                                 │
│ backup ── pg_dump | gzip | age | rclone, uma vez por dia        │
│                                                                 │
│ ClickHouse (logs)   Postgres (contas, projetos, keys, alertas)  │
│ volumes: spool da contingência, bloqueios, source maps          │
└─────────────────────────────────────────────────────────────────┘
   │
   └─► bucket S3 fora da máquina: backup do ClickHouse e do Postgres
```

- **A ingestão não depende do Postgres nem do Redis.** As keys vêm do documento do seed, lido do disco e recarregado sozinho quando o arquivo muda. O princípio não mudou com a plataforma: o caminho quente da ingestão não consulta banco de metadados.
- **Nada publica porta além do Caddy.** O ClickHouse e o Postgres existem só na rede dos containers.
- **Uma credencial do ClickHouse por papel:** `reader`, `ingest`, `jobs`, `backup` e `migrator`, cada uma com o *grant* mínimo, conferidas por teste (seção 7).
- **A máquina não é descartável, e é por isso que existe backup.** Um VPS com disco próprio não se recria sozinho como a VM anterior: o ClickHouse manda `BACKUP DATABASE` para um bucket fora da máquina uma vez por dia, e o Postgres vai pelo mesmo cano, cifrado com `age`.
- **Endereços:** `nekolog.io` (site e documentação), `ingest.nekolog.io`, `api.nekolog.io` e o do dashboard, quando ele chegar na máquina. Todos são registros A apontando para o mesmo endereço, *proxied* pelo Cloudflare, declarados em `infra/vps`.
- **Um repositório, uma máquina:** os cinco apps e o dashboard compartilham o mesmo ClickHouse e o mesmo Postgres.

### O que a máquina dá, e o que aperta

| Peça | Onde | Limite que importa |
|---|---|---|
| Ingestão, API e jobs | containers Node na VPS | 1 vCPU dividido com o banco; o orçamento próprio é de **10 ms de CPU** por request |
| Agendamento | agendador dentro do container de jobs | acorda na virada de cada minuto; nenhuma rota executa tarefa |
| Keys na ingestão | documento do seed, num volume | relido sozinho a cada 15 s quando o arquivo muda |
| Logs | ClickHouse na própria máquina | memória: o teto do processo é menor que o do container, de propósito |
| Metadados | Postgres na própria máquina | — |
| Contingência e source maps | volumes do Docker | o `capacity-watch` avisa antes de encher |
| Backup | bucket S3 fora da máquina | regra de ciclo de vida no prefixo `clickhouse/` |
| E-mail | Resend | 3.000/mês, 100/dia, exige domínio verificado |
| Borda | Cloudflare Free | DNS, TLS e proteção; é o que substituiu o Workers |
| Repositório, CI | GitHub + Actions | minutos contados, porque o repositório é privado |

**Os 10 ms não são mais um limite de plataforma, e continuam valendo.** Eles eram o teto de CPU por request do Cloudflare Workers; a VPS não impõe nenhum. Mas é **1 vCPU** dividido entre o ClickHouse, o Postgres, quatro processos Node e o Caddy, então um request que gaste muito tempo de CPU tira o tempo do banco que ele mesmo vai consultar. O número virou teto auto-imposto, `apps/ingest/src/budget.test.ts` continua guardando, e o que ele obrigou a fazer — memoizar o fingerprint por lote, baixar o lote padrão de 500 para 200 — continua sendo melhor engenharia.

## 5. Como roda numa máquina só

Tudo roda num `docker-compose`: a ingestão, a API pública de leitura, os jobs, o site, a documentação, o ClickHouse, o Postgres e o proxy. O dashboard entra como mais um container, pelo item B7 de [COMERCIAL.md](COMERCIAL.md).

A troca de cada peça da plataforma anterior pelo que roda aqui:

| Plataforma anterior | Hoje |
|---|---|
| Workers (ingest, api, jobs) | containers Node com o mesmo app Hono |
| Workers KV | arquivos num volume (`@internal/self-host`) |
| R2 (contingência, source maps) | volumes do Docker |
| R2 (backup) | um bucket S3 fora da máquina, que é o único serviço externo que guarda dado |
| Cron Triggers | agendador dentro do container de jobs |
| Neon, Upstash, VM Oracle | Postgres, Valkey e ClickHouse no próprio compose |
| Vercel | containers de `web` e `docs` atrás do mesmo Caddy |
| Cloudflare Tunnel e Access | nada: o banco está na mesma máquina que os apps |

**Por que isso foi barato de fazer:** o princípio 2 desta seção — todo comportamento de fornecedor atrás de uma interface — existe desde o M1. Trocar a plataforma inteira foi escrever implementações novas de `KeyStore` e `BlobStore` e apagar as antigas, não reescrever a aplicação.

No ambiente de desenvolvimento, o compose também sobe o **Mailpit**, que captura todos os e-mails numa página local, e o **Garage** (mesma API S3 — ver ADR [0013](adr/0013-garage-no-lugar-do-minio.md)), que é contra o que o backup é testado.

---

## 6. Projetos, ambientes e keys

**Hierarquia:** Organização → Projeto → Ambiente → Keys

- Todo projeto nasce com `production`, `staging` e `development`. O usuário pode criar outros (`qa`, `preview`…), cada um com uma cor.
- Cada ambiente pode ter várias keys, para rotacionar sem downtime:
  - `nekolog_pk_…` (pública): só envia logs, usada no front.
  - `nekolog_sk_…` (secreta): envia e/ou lê logs pela API, com escopos (`logs:write`, `logs:read`).
- **A key define o ambiente.** O SDK não precisa da opção `environment`, e uma key de staging nunca grava em produção.
- **Configurações por ambiente:** origens permitidas (keys públicas), retenção em dias, nível mínimo aceito, taxa de amostragem, cota diária e regras extras de remoção de dados sensíveis. O nível mínimo e a amostragem são **cumpridos na ingestão**, não na tela: a tela escreve a coluna, a key leva o valor até o Worker pela KV e o evento que não passa nunca chega a virar linha. A amostragem é **determinística**, semeada no `traceId` (ou, na falta dele, na sessão), para um trace inteiro ficar ou sair junto — amostrar evento a evento deixaria metade de um trace, que não serve para investigar nada. E **`error` e `fatal` nunca são amostrados**: perder erro por amostragem é exatamente o que ninguém quer.
- **Segurança das keys:** só o hash SHA-256 é guardado; a key aparece uma única vez; o dashboard mostra o "último uso". Ao criar ou revogar, o dashboard atualiza o KV, e a revogação leva até ~60 s para valer em todo lugar.
- **No browser, a key vai na URL** (`/v1/logs?key=pk_…`), porque o `sendBeacon` não envia headers. No back-end, vai em `Authorization: Bearer sk_…`.

---

## 7. Modelo de dados

### Postgres (Drizzle)

- **Usuários e acesso:** `users`, `organizations`, `memberships` (owner/admin/member/viewer), `invites`
- **Projetos:** `projects`, `environments`, `api_keys`
- **Investigação:** `saved_views`, `dashboards`, `issues` (status, responsável, primeira e última ocorrência), `releases`
- **Alertas:** `alert_rules`, `alert_channels`, `alert_events`. O segredo de um canal nunca fica em claro: a coluna `sealed_secret` guarda `v1.<nonce>.<cifra>` em hexadecimal (AES-256-GCM com a `ENCRYPTION_KEY`, e o **id do canal como dado autenticado**, então um segredo copiado para outra linha não abre), e uma *check constraint* recusa qualquer coisa fora desse formato. O endereço de um webhook passa pela proteção contra SSRF **na escrita e de novo no envio**, porque a linha pode ser mais velha que a proteção (ameaça E7).
- **Auditoria:** `audit_log`

A tabela `users` tem `id`, `name`, `email` (único, em minúsculas), `password_hash`, `email_verified_at`, `password_changed_at`, `locale`, `timezone`, `is_operator`, `suspended_at` e `created_at`. Sessões e códigos não ficam no Postgres.

### ClickHouse

```sql
CREATE TABLE logs (
  project_id      LowCardinality(String),
  environment_id  LowCardinality(String),
  timestamp       DateTime64(3),
  received_at     DateTime64(3),
  clock_skew_ms   Int64,                    -- received_at - timestamp do cliente
  level           LowCardinality(String),
  message         String,
  service         LowCardinality(String),
  release         LowCardinality(String),
  source          LowCardinality(String),   -- browser | node | edge
  trace_id        String,
  span_id         String,
  session_id      String,
  user_id         String,
  fingerprint     UInt64,                   -- agrupamento de erros
  error_type      String,
  stacktrace      String,
  attributes      Map(LowCardinality(String), String),
  country         LowCardinality(String),   -- no lugar do IP
  retention_days  UInt16,
  INDEX idx_message lower(message) TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 4,
  INDEX idx_trace   trace_id TYPE bloom_filter GRANULARITY 4
) ENGINE = MergeTree
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (project_id, environment_id, timestamp)
TTL toDateTime(timestamp) + toIntervalDay(retention_days)
SETTINGS non_replicated_deduplication_window = 1000;
```

- O índice da mensagem é sobre `lower(message)`, para a busca por palavra funcionar sem diferenciar maiúsculas (especificação 4).
- O `non_replicated_deduplication_window` permite usar o `batchId` como token de deduplicação no reenvio da contingência.

- O `retention_days` vem da configuração do ambiente e é gravado em cada linha, então o `TTL` respeita a retenção de cada ambiente sem job de limpeza. Uma mudança na retenção vale só para logs novos.
- **O `TTL` e o `PARTITION BY` são sobre o `timestamp`, que é do cliente, então a ingestão limita esse valor antes de gravar** (etapa 4.11). Um relógio atrasado além da retenção faz o ClickHouse descartar a linha no próprio insert — a partição é criada com zero linhas e nada avisa. Um relógio adiantado grava numa partição fora de qualquer consulta por período, e cujo `TTL` só vence depois dela: é a ameaça T10. A diferença real fica em `clock_skew_ms`.
- A *materialized view* `logs_per_minute` (contagem por projeto, ambiente, nível, serviço e minuto do `timestamp`) alimenta os gráficos. A `usage_per_minute` (por projeto, ambiente e minuto do `received_at`) alimenta uso e cota: o `timestamp` é escolhido pelo cliente, então cobrar cota por ele permitiria fugir da cota datando os eventos no passado.
- **O usuário de ingestão não pode ser só de `INSERT`.** O ClickHouse pede `SELECT` nas colunas que a *materialized view* lê, e sem isso o `INSERT` grava em `logs`, falha ao alimentar a view e devolve erro — gravação pela metade. Então ele tem `INSERT` em `logs` e `SELECT` **restrito às seis colunas** que as views leem (`project_id`, `environment_id`, `timestamp`, `received_at`, `level`, `service`). `message`, `stacktrace`, `attributes` e `user_id` continuam fora do alcance dessa credencial (ameaça E11).

---

## 8. SDKs (pacotes npm)

| Pacote | O que faz |
|---|---|
| `@nekolog-io/core` | níveis, `child()`, contexto, envio em lote, retry com backoff (respeita `429 Retry-After`), amostragem, `beforeSend`, remoção de dados sensíveis, `flush()`. Zero dependências; roda em browser, Node, Bun, Deno e edge |
| `@nekolog-io/browser` | erros globais e promises rejeitadas, breadcrumbs (cliques, navegação, fetch), sessão, `setUser`, envio no `pagehide` via `sendBeacon`, fila offline (IndexedDB), `traceparent` só nos domínios configurados |
| `@nekolog-io/node` | contexto por request com `AsyncLocalStorage`, captura de `uncaughtException` e `unhandledRejection`, flush no `SIGTERM` |
| `@nekolog-io/react`, `@nekolog-io/next` | Provider, `ErrorBoundary`, `useLogger`; integração via `instrumentation.ts` |
| `@nekolog-io/express`, `fastify`, `hono`, `nestjs` | middleware ou interceptor: requestId, `traceparent`, log de cada request |
| `@nekolog-io/pino`, `@nekolog-io/winston` | transports para quem já usa essas libs adotar sem reescrever logs |
| `@nekolog-io/cli` + `@nekolog-io/bundler-plugin` | comando `nekolog`: registrar release e subir source maps; o plugin usa `unplugin` (Vite, webpack, Rollup e esbuild) |

```ts
import { createLogger } from '@nekolog-io/node'

const log = createLogger({
  apiKey: process.env.NEKOLOG_KEY!, // a key já define projeto e ambiente
  service: 'core-service',
  release: '1.4.2',
})

log.info('Pedido criado', { orderId: 123 })
log.child({ requestId }).error(err, { step: 'pagamento' })

await log.flush() // essencial em serverless
```

- Remoção de dados sensíveis por padrão: `password`, `token`, `authorization`, `cpf`, números de cartão. A busca é por **chave** (qualquer segmento do caminho achatado) e por **valor** no texto: par `chave=valor` com chave sensível (`?token=abc`, `{"password":"x"}`), cartão validado por Luhn, CPF pelos dígitos verificadores, JWT, `Bearer`/`Basic`, credencial dentro de URL e a própria key do NekoLog. A validação existe para não apagar um id de pedido só porque tem 16 dígitos.
- **A remoção é a última etapa do pipeline**, depois do `beforeSend`: o gancho vê o evento cru e pode rotear por ele, mas não consegue desfazer a remoção. O que o `beforeSend` devolve é revalidado contra o contrato da ingestão. A amostragem é **consistente por trace** (hash do `traceId`), para uma request não ficar pela metade, e `error`/`fatal` não são amostrados por padrão, porque alerta e issue contam erro. Detalhes e alternativas descartadas no ADR [0014](adr/0014-ordem-do-pipeline-de-privacidade-do-sdk.md).
- SDK de browser com tamanho verificado no CI pelo `size-limit`. **A meta de
  5 KB gzip escrita aqui não foi cumprida, e isso está medido, não estimado**
  (etapa 3.12, 03/11/2026): `init` — o SDK inteiro, com breadcrumbs, fila
  offline e `traceparent` — custa **12,05 KB gzip**, e `createLogger` sozinho,
  que é logger, envio em lote e o filtro de dados sensíveis, custa **9,4 KB**.
  O `@nekolog-io/core` é 74% desse peso, e já sai *tree-shaken*: 40 KB de
  fonte viram 17,5 KB no bundle. O que sobra é o que o próprio plano pede —
  remoção de dados sensíveis com Luhn e CPF, achatamento de atributos, retry
  com backoff, amostragem. Chegar aos 5 KB significaria cortar o filtro de
  privacidade, que é um requisito da seção 14, não enfeite. O `size-limit`
  trava os números onde eles estão hoje, para não subirem em silêncio;
  rediscutir a meta é decisão de produto, não de implementação.
- Para o `traceparent` ir do front ao back, o back-end precisa liberar esse header no CORS; isso entra no guia de cada framework.
- **Primeiro uso:** `npx @nekolog-io/cli init` detecta o framework, instala o SDK certo e cria o `.env` com a key.
- Versões suportadas e política de compatibilidade: seção 16.

---

## 9. APIs

### Ingestão

- `POST /v1/logs`: lote `{ events: [...] }`, aceita gzip. Respostas: `202`, `400` (schema), `401` (key), `403` (origem), `413` (tamanho), `429` (com `Retry-After`).
- `POST /v1/otlp/logs`: aceita OTLP/HTTP em JSON.
- **Formato completo** do payload, das respostas e dos códigos de erro: especificação 1 do [ESPECIFICACOES.md](ESPECIFICACOES.md).
- **Limites:** ~512 KB por lote, ~16 KB por mensagem, até 100 atributos.
- **Validação leve com Valibot**, por causa dos 10 ms de CPU por request (seção 19.1).
- **Resposta imediata e contingência:** a ingestão responde `202` assim que valida o lote e grava em segundo plano. Se o insert no ClickHouse falhar, o lote vai para o volume do spool e os jobs reenviam quando o ClickHouse voltar, com um token de deduplicação por lote para nada ser gravado duas vezes. O token é `<environmentId>:<batchId>`, nunca o `batchId` sozinho: ele é escolhido pelo cliente, e o ClickHouse deduplica por partição, que todos os projetos dividem.
- **Limite de atributos:** no máximo 500 chaves distintas em `attributes` por projeto; chaves novas além disso são descartadas e aparecem no uso.
- **Rate limit sem Redis:**
  - a config da key fica em cache na memória do processo por 60 s, e um contador por instância segura rajadas — é freio de rajada, não controle de volume, e a documentação diz isso em vez de prometer o que ele não garante;
  - a cota diária é controlada pelos jobs: a cada minuto, eles somam o uso do dia na `usage_per_minute` e mantêm um documento com a lista de ambientes bloqueados. A ingestão lê essa lista (também em cache de 60 s) e passa a responder `429`. O documento só é reescrito quando o conjunto muda.

### Consulta

- O dashboard consulta o ClickHouse pelas rotas do próprio Next.js (usuário só com `SELECT`).
- API pública de leitura com key `sk_` e escopo `logs:read`: busca, histograma e issues.
- **Busca:** sintaxe como `level:error service:api status>=500 "timeout" -env:dev`. Vira uma AST e depois SQL parametrizado. O servidor injeta o filtro de projeto e ambiente em toda query, nunca o usuário. Isso tem testes próprios de isolamento entre projetos. A gramática completa está na especificação 4.

---

## 10. Dashboard

> **Onde ele mora:** em `apps/dashboard`, neste repositório, desde a ADR [0019](adr/0019-um-repositorio-so.md). Esta seção é a especificação de produto que ele tem de seguir.

**Stack:** Next.js (App Router), Tailwind v4 + shadcn/ui (tema Grafite), `next-themes`, TanStack Query, Table e Virtual, ECharts, `nuqs` (filtros na URL), Drizzle e o módulo `internal/auth`.

- **Explorer:** período, busca, filtros, tabela virtualizada com scroll infinito, detalhe em JSON, "ver contexto" (logs antes e depois). O tempo real é feito com polling a cada 2–3 s.
- **Trace view:** todos os logs com o mesmo `trace_id`, do clique no front até a query no back, numa linha do tempo.
- **Gráficos e dashboards:** volume por nível, taxa de erro, serviços e erros mais frequentes; dashboards customizáveis com widgets.
- **Issues:** erros agrupados por fingerprint, com status (aberta, resolvida, ignorada), contagem e stack trace com o código original. O source map é aplicado na hora de exibir, não na ingestão.
- **Alertas:** regras de limiar, taxa de erro, nova issue, regressão de issue e ausência de logs (especificação 6); canais e-mail, Slack, Discord e webhook assinado; cooldown e histórico.
- **Configurações:** ambientes, keys, membros e papéis, retenção, amostragem, cotas e uso, sessões ativas e audit log.
- **Demo pública:** um botão "Entrar na demo" abre uma sessão somente leitura numa organização com logs falsos, sem senha nem e-mail. O papel somente leitura é garantido no servidor.
- **Primeiro log:** depois de criar o projeto, um passo a passo mostra a key e o comando `npx @nekolog-io/cli init` e fica esperando o primeiro log chegar, em tempo real.
- **Fuso horário:** tudo é gravado em UTC e exibido no fuso de cada usuário (preferência salva no perfil).
- **Relógio do cliente:** a ingestão grava a diferença em `clock_skew_ms` e o dashboard avisa quando ela passa de 5 min. A coluna guarda a diferença real, mesmo quando o `timestamp` gravado foi limitado (ver especificação 1), então o horário que o cliente mandou é sempre `received_at - clock_skew_ms`.
- **Exportação de logs:**
  - **Formatos:** JSON (NDJSON, um log por linha), XML e CSV (protegido contra injeção de fórmulas).
  - **Manual:** o usuário escolhe filtros e período no Explorer e pede a exportação.
  - **Agendada:** por projeto e ambiente, diária ou semanal, por exemplo para guardar os logs antes de a retenção apagá-los.
  - **Geração:** o próprio ClickHouse gera o arquivo no formato escolhido e grava comprimido num bucket S3 (`INSERT INTO FUNCTION s3(...)`), sem gastar CPU da aplicação. A credencial vai dentro do `INSERT` — o ClickHouse troca o segredo por `[HIDDEN]` no `query_log`, mas a mensagem de erro não é mascarada, então a tarefa dos jobs tira a chave e o segredo de qualquer texto antes de gravá-lo na coluna `failure`.
  - **Credencial do ClickHouse:** a exportação roda com o usuário `nekolog_jobs`, que ganha `WRITE ON S3` e `CREATE TEMPORARY TABLE` (a *table function* não existe sem ela) e **continua sem `READ ON S3`** — ele escreve uma exportação e não consegue ler nenhum objeto de volta para dentro do banco.
  - **Exportação vazia:** quando o filtro não casa com nada, o ClickHouse **não cria objeto nenhum**. A tarefa grava ela mesma um gzip vazio na chave, porque `ready` tem de significar que há o que baixar — é o que a *check constraint* `exports_ready_means_there_is_an_object` promete.
  - **Agendamento:** o período exportado é sempre o que **acabou de fechar** — o dia anterior (meia-noite UTC) ou a semana anterior (segunda a segunda, em UTC), nunca o período em curso. Os jobs esperam 15 minutos depois do fim do período antes de gerar, para os logs atrasados ainda entrarem. Um agendamento criado depois do fim de um período não exporta esse período, e o `last_run_at` é carimbado no mesmo `INSERT` que cria a exportação, então o mesmo período nunca sai duas vezes.
  - **Entrega por e-mail com link, não com anexo:** o e-mail avisa que a exportação está pronta e leva ao dashboard, que exige login e permissão no ambiente antes de liberar o download. Logs podem ter dados sensíveis, anexos ficam para sempre na caixa de e-mail e e-mails têm limite de tamanho. O aviso sai nos três idiomas, escolhido pelo `locale` do usuário, e **não carrega nenhum texto que alguém digitou** — nem o filtro da exportação, nem o nome do ambiente: só período, contagem, tamanho, validade e o link. É o que dispensa confiar no escape de HTML dentro do e-mail. O aviso só vai para quem verificou o e-mail e não está suspenso, e só para exportação agendada — a manual aparece na tela de quem pediu.
  - **Validade:** os arquivos ficam 7 dias no bucket e depois são apagados por uma regra de ciclo de vida.
  - **Isto não está ligado na máquina.** A exportação precisa de um bucket que o ClickHouse alcance com credencial própria, e o usuário `nekolog_jobs` do compose não tem *grant* nenhum em S3 — o único bucket externo que existe hoje é o do backup, e dar acesso de exportação a ele seria dar escrita no backup. Ligar a exportação é decidir um segundo bucket.
  - Na instância hospedada, até uma exportação agendada por dia por projeto, por causa da cota de e-mails.
- **Acessibilidade:** meta WCAG 2.2 AA, navegação completa por teclado e testes automáticos com axe no Playwright.
- **Idiomas:** português, inglês e espanhol (seção 13).

### 10.1 Mapa de telas

**Acesso (sem login)**

| Rota | Tela |
|---|---|
| `/login` e `/login/code` | e-mail e senha; depois, o código de 6 caracteres |
| `/signup?invite=…` | cadastro a partir de um convite |
| `/verify-email` | confirmação do e-mail com código |
| `/forgot-password` e `/reset-password` | recuperação de senha |
| `/demo` | entra na demo somente leitura |
| `/legal/terms` e `/legal/privacy` | termos de uso e política de privacidade |

**Organização e projeto** (`/[org]/[project]/…`)

| Rota | Tela |
|---|---|
| `/[org]/projects` | lista de projetos e criação de projeto |
| `…/setup` | passo a passo do primeiro log |
| `…/logs` | Explorer; o detalhe de um log abre num painel lateral (`?log=…`) |
| `…/traces/[traceId]` | linha do tempo de um trace |
| `…/issues` e `…/issues/[id]` | erros agrupados e detalhe com stack trace |
| `…/dashboards` e `…/dashboards/[id]` | dashboards customizáveis |
| `…/alerts` | regras de alerta e histórico |
| `…/releases` | releases e source maps |
| `…/exports` | exportações manuais e agendadas |
| `…/settings` | geral, ambientes (origens, retenção, amostragem, nível mínimo) e keys |
| `/[org]/settings` | geral, membros e convites, canais de alerta, uso e cotas, audit log |
| `/account` | perfil (nome, idioma, fuso, tema) e segurança (senha, e-mail, sessões ativas) |
| `/operator` | área do operador da instância |

**Navegação:**

- **Barra lateral:** seletor de organização e projeto no topo; depois Logs, Issues, Dashboards, Alertas, Releases, Exportações e Configurações.
- **Barra superior:** seletor de ambiente (com a cor do ambiente), busca, tema e menu da conta.
- **O ambiente fica na URL** (`?env=production`), para qualquer link compartilhado abrir exatamente o que a pessoa viu.

**Estados de toda tela:** carregando (skeleton), vazio (com o próximo passo, por exemplo "envie seu primeiro log"), erro, sem permissão e cota estourada (aviso no topo).

### 10.2 Papéis e permissões

| Ação | owner | admin | member | viewer |
|---|:-:|:-:|:-:|:-:|
| Ver logs, gráficos, traces e issues (todos os ambientes) | ✓ | ✓ | ✓ | ✓ |
| Criar views salvas e dashboards | ✓ | ✓ | ✓ | — |
| Mudar status e responsável de issues | ✓ | ✓ | ✓ | — |
| Criar e editar regras de alerta | ✓ | ✓ | ✓ | — |
| Configurar canais de alerta (e-mail, Slack, Discord, webhook) | ✓ | ✓ | — | — |
| Exportar logs (manual e agendada) | ✓ | ✓ | — | — |
| Criar e configurar projetos e ambientes | ✓ | ✓ | — | — |
| Criar, revogar e rotacionar keys | ✓ | ✓ | — | — |
| Convidar e remover membros e mudar papéis | ✓ | ✓¹ | — | — |
| Ver o audit log | ✓ | ✓ | — | — |
| Apagar projetos (pedindo a senha de novo) | ✓ | ✓ | — | — |
| Apagar a organização e transferir a propriedade | ✓ | — | — | — |

¹ Um admin não pode promover ninguém a owner nem alterar ou remover um owner.

- Toda organização tem pelo menos um owner; o último owner só sai depois de transferir a propriedade.
- Essa matriz fica num único arquivo de código (`internal/auth/permissions.ts`), usado pelo servidor em toda rota e pelos testes, que verificam cada célula da tabela.
- A sessão da demo funciona como viewer da organização demo.
- **O operador da instância não é um papel de organização:** ele vê uso, cotas e status das organizações, mas não o conteúdo dos logs.

---

## 11. Autenticação

Módulo próprio em `internal/auth`, com `@node-rs/argon2`, `jose`, Redis e a API do Pwned Passwords. As rotas em `apps/dashboard/app/api/auth/` são finas e só chamam o módulo. (Diziam `apps/web` enquanto o dashboard era outro repositório; corrigido com a ADR [0019](adr/0019-um-repositorio-so.md).)

### 11.1 Fluxos

1. **Cadastro (só por convite, seção 15.1):** o link do convite já traz o e-mail; a pessoa define nome e senha → código no e-mail → conta confirmada. Sem confirmar, não dá para entrar.
2. **Login:**
   - `POST /login/start` recebe e-mail e senha. Se a senha estiver certa, gera o código, envia por e-mail e grava um cookie assinado com o `challenge` dessa tentativa.
   - `POST /login/verify` recebe o código, que só vale junto com o cookie (mesmo navegador). Se estiver certo, cria a sessão.
   - `POST /login/resend` reenvia, respeitando a espera de 60 s.
3. **Esqueci a senha:** e-mail → código → nova senha → todas as sessões encerradas.
4. **Trocar e-mail:** pede a senha de novo e envia um código para o e-mail atual e outro para o novo.

As mensagens são sempre genéricas ("e-mail ou senha inválidos", "se o e-mail existir, enviamos um código"). Quando o e-mail não existe, o servidor roda uma verificação de argon2 de mentira, para a resposta levar o mesmo tempo.

### 11.2 Códigos por e-mail

| Regra | Valor |
|---|---|
| Formato | 6 caracteres, maiúsculas e números, exibidos como `K7Q-M2P` |
| Alfabeto | 31 caracteres, sem `0/O` e `1/I/L` (~887 milhões de combinações) |
| Digitação | aceita minúsculas, espaços e hífen, normalizados antes da comparação |
| Validade | 10 minutos, uso único; um código novo invalida o anterior |
| Tentativas | 5 erros encerram a tentativa |
| Reenvio | espera de 60 s, no máximo 5 envios por hora por conta |
| Armazenamento | HMAC-SHA256 de `challenge:código` com `AUTH_OTP_SECRET` |
| Tipos | `login`, `verify-email`, `reset-password`, `change-email` |

```ts
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // sem 0/O e 1/I/L

export function generateCode(length = 6) {
  const out: string[] = []
  const byte = new Uint8Array(1)
  while (out.length < length) {
    crypto.getRandomValues(byte)
    if (byte[0] < 248) out.push(ALPHABET[byte[0] % 31]) // 248 = 31 × 8, evita viés
  }
  return out.join('')
}

export const normalizeCode = (input: string) =>
  input.toUpperCase().replace(/[^A-Z0-9]/g, '')
```

**Gerar código** (`lua/issue-otp.lua`):

```lua
-- KEYS: 1=otp:{tipo}:{id}  2=otp:cooldown:{tipo}:{id}  3=otp:sends:{tipo}:{id}
-- ARGV: 1=challenge  2=codeHash  3=ttl  4=cooldown  5=maxSends
if not redis.call('SET', KEYS[2], 1, 'NX', 'EX', ARGV[4]) then return -1 end  -- em espera
local sends = redis.call('INCR', KEYS[3])
if sends == 1 then redis.call('EXPIRE', KEYS[3], 3600) end
if sends > tonumber(ARGV[5]) then return -2 end                               -- limite por hora
redis.call('DEL', KEYS[1])
redis.call('HSET', KEYS[1], 'challenge', ARGV[1], 'code', ARGV[2], 'attempts', 0)
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1
```

**Verificar código** (`lua/verify-otp.lua`):

```lua
-- KEYS: 1=otp:{tipo}:{id}   ARGV: 1=challenge  2=codeHash  3=maxAttempts
local d = redis.call('HMGET', KEYS[1], 'challenge', 'code')
if not d[1] or d[1] ~= ARGV[1] then return 0 end                -- expirado ou de outro navegador
if d[2] == ARGV[2] then redis.call('DEL', KEYS[1]) return 1 end  -- certo
if redis.call('HINCRBY', KEYS[1], 'attempts', 1) >= tonumber(ARGV[3]) then
  redis.call('DEL', KEYS[1]) return -2                          -- tentativas esgotadas
end
return -1                                                       -- errado
```

Como o script compara HMACs, medir o tempo da comparação não revela nada sobre o código.

### 11.3 Access token e refresh token

| | Access token | Refresh token |
|---|---|---|
| Formato | JWT assinado com Ed25519 (`jose`) | `{sid}.{segredo}`, com 32 bytes aleatórios |
| Validade | 10 min | 7 dias sem uso, 30 dias no máximo |
| Cookie | `__Host-at`, `HttpOnly`, `Secure`, `SameSite=Lax` | `__Host-rt`, `HttpOnly`, `Secure`, `SameSite=Lax` |
| No servidor | nada; validado pela assinatura | hash em `sess:{sid}` no Redis |
| Conteúdo | `sub`, `sid`, `iss`, `aud`, `exp` | — |

- Os papéis na organização **não** vão no token; são consultados no servidor, então mudam na hora.
- O Redis só é consultado a cada ~10 min de uso (na renovação) e nas ações sensíveis.
- Os tokens nunca vão para o `localStorage`.
- **"Lembrar este dispositivo":** marcado, o cookie persiste com as regras de 7/30 dias; desmarcado, o cookie some ao fechar o navegador e a sessão dura no máximo 12 h.

**Rotação e reuso:** a cada renovação, o refresh token muda. Se um token já usado aparecer, a sessão inteira é encerrada, o evento vai para o audit log e o usuário recebe um aviso por e-mail. Requests simultâneas com o mesmo token têm uma **janela de graça de 30 s**: o token anterior ainda gera um access token novo, mas não outro refresh token (o navegador compartilha os cookies entre abas, então a outra request já recebeu o refresh novo).

**Renovar** (`lua/rotate-refresh.lua`):

```lua
-- KEYS[1] = sess:{sid}
-- ARGV: 1=hash do token recebido  2=hash do novo token  3=agora (ms)
--       4=fim da janela de graça (ms)  5=inatividade máxima (s)
local s = redis.call('HMGET', KEYS[1], 'cur', 'prev', 'prevUntil', 'absExp')
if not s[1] then return 0 end                               -- sessão expirada ou revogada

if ARGV[1] == s[1] then                                     -- token atual: troca
  local ttl = math.min(tonumber(ARGV[5]), math.floor((tonumber(s[4]) - tonumber(ARGV[3])) / 1000))
  if ttl <= 0 then redis.call('DEL', KEYS[1]) return 0 end  -- passou do limite de 30 dias
  redis.call('HSET', KEYS[1], 'cur', ARGV[2], 'prev', s[1], 'prevUntil', ARGV[4], 'lastUsed', ARGV[3])
  redis.call('EXPIRE', KEYS[1], ttl)
  return 1
end

if ARGV[1] == s[2] then
  if tonumber(ARGV[3]) <= tonumber(s[3]) then return 2 end  -- request simultânea: só novo access token
  redis.call('DEL', KEYS[1]) return -1                      -- token já usado: encerra a sessão
end

return 0                                                    -- token desconhecido: só recusa
```

Um token desconhecido é só recusado, sem encerrar a sessão, para que ninguém derrube a sessão de outra pessoa conhecendo apenas o `sid`.

### 11.4 Renovação no Next.js

- O `proxy.ts` (chamado `middleware.ts` até o Next 15) roda antes de cada página e de cada `/api`. Com o access token válido, segue a request. Com ele vencido e o refresh válido, renova ali mesmo e segue, sem o usuário perceber.
- Ao renovar, o proxy grava os cookies novos na resposta **e** substitui o cookie na request que segue adiante, para os Server Components daquela mesma request verem o token novo.
- Cada route handler valida o JWT de novo. Nenhum header repassado pelo proxy (como `x-user-id`) é confiável.
- Todo `POST` confere o header `Origin`, além do `SameSite`.

### 11.5 Revogação

| Evento | Efeito |
|---|---|
| Logout | apaga `sess:{sid}` e limpa os cookies |
| "Sair de todos os dispositivos" | apaga todas as sessões de `sess:user:{userId}` |
| Troca ou recuperação de senha | encerra todas as sessões |
| Reuso de token detectado | encerra a sessão, registra e avisa por e-mail |
| Ações sensíveis (keys, membros, apagar projeto) | conferem `EXISTS sess:{sid}`, então uma sessão revogada é barrada na hora |
| Trocar e-mail ou apagar a organização | pedem a senha de novo |

### 11.6 Senhas e proteção de contas

- Hash com **argon2id**: 19 MiB de memória, 2 iterações, paralelismo 1 (mínimo recomendado pela OWASP).
- Mínimo de 12 e máximo de 128 caracteres, sem exigir símbolos; recusada se aparecer na base do Pwned Passwords (consulta k-anonymity, que envia só 5 caracteres do hash).
- **Rate limit:** por conta, 5 senhas erradas em 15 min ativam uma espera crescente (1, 2, 4, 8 até 15 min); por IP, 20 tentativas em 15 min.
- **Cloudflare Turnstile** (gratuito) no cadastro, no login e no "esqueci a senha", para bots não esgotarem a cota de e-mails.
- O e-mail do código mostra navegador, país e horário, com o aviso "se não foi você, troque sua senha", e nunca tem link que faz login.

### 11.7 Chaves no Redis

| Chave | Para quê |
|---|---|
| `otp:{tipo}:{id}` | código atual, `challenge` e tentativas (TTL de 10 min) |
| `otp:cooldown:{tipo}:{id}` | espera de 60 s entre envios |
| `otp:sends:{tipo}:{id}` | máximo de 5 envios por hora |
| `sess:{sid}` | refresh atual e anterior, janela de graça, limite de 30 dias, aparelho, país |
| `sess:user:{userId}` | sessões do usuário |
| `rl:{escopo}:{id}` | rate limit de login, cadastro e recuperação de senha |

O Valkey da máquina usa `ioredis`; o adaptador HTTP (`@upstash/redis`) continua existindo e é escolhido pela variável presente (`REDIS_URL` ou `UPSTASH_REDIS_REST_URL`). Nenhum dos dois é dependência do pacote: `nodeRedis` recebe um cliente injetado e `upstashRedis` precisa só de `fetch`.

### 11.8 E-mail

- Adaptador `Mailer`: Resend em produção, SMTP para quem preferir, Mailpit em desenvolvimento. Templates em React Email.
- A Resend só envia para outras pessoas com domínio verificado. O remetente será `no-reply@nekolog.io`.
- O plano gratuito permite 100 e-mails por dia. Com refresh token, o login com código só acontece a cada 7–30 dias por pessoa.
- **Toda mensagem é conferida antes da chamada de rede:** `assertMessage` recusa `\r`, `\n` ou byte nulo no destinatário e no assunto — é assim que se forja um `bcc:` invisível — e exige um endereço único em minúsculas. Em desenvolvimento, a `EMAIL_ALLOWLIST` manda e **lista vazia não libera ninguém**: variável ausente é máquina nova, não permissão para escrever para estranhos.
- O envio não bloqueia a resposta, para o tempo de resposta não revelar se a senha estava certa.

### 11.9 Endpoints

| Grupo | Endpoints |
|---|---|
| Cadastro | `signup`, `verify-email` |
| Login | `login/start`, `login/verify`, `login/resend` |
| Sessão | `refresh`, `logout`, `logout-all`, `sessions` (listar e encerrar) |
| Senha | `password/forgot`, `password/reset`, `password/change` |
| E-mail | `email/change` |

### 11.10 Segredos

| Variável | Uso |
|---|---|
| `AUTH_JWT_PRIVATE_KEY`, `AUTH_JWT_PUBLIC_KEY` | par Ed25519 dos JWT; o `kid` no token permite aceitar a chave atual e a anterior durante uma troca |
| `AUTH_OTP_SECRET` | chave do HMAC dos códigos |
| `UPSTASH_REDIS_REST_URL` + token, ou `REDIS_URL` | Redis |
| `RESEND_API_KEY`, ou `SMTP_URL` | e-mail |

### 11.11 Testes

- **Códigos:** expirado, reutilizado, 6ª tentativa, outro navegador, espera de reenvio, 6º envio na hora.
- **Sessões:** renovação normal, reuso encerrando a sessão, 10 requests paralelas com o mesmo token, limite de 30 dias, sair de todos os dispositivos, recuperação de senha encerrando sessões, ação sensível barrada logo após a revogação.
- Os scripts Lua rodam contra um Redis de verdade no CI. Os testes e2e leem os códigos pela API do Mailpit.
- **Checklist:** capítulos de autenticação e sessão do OWASP ASVS, mais os guias da OWASP de autenticação, armazenamento de senhas, sessões e recuperação de senha. O `internal/auth` passa por uma revisão de segurança dedicada antes da demo pública.

---

## 12. Tema visual

Paleta **Grafite**: interface neutra (zinco), com tema claro e escuro. O arquivo `tema/globals.css` já está pronto e vai para `apps/web/app/globals.css`.

- Tokens do shadcn/ui em OKLCH (com o hex comentado), tema escuro pela classe `.dark` e `color-scheme` em cada tema.
- Tokens próprios usáveis como classes do Tailwind: `bg-level-error`, `bg-chart-3`, `bg-env-production`, `text-success`.
- Geist Sans na interface e Geist Mono nas mensagens de log.
- Seletor de tema com `next-themes` (`attribute="class"`, `defaultTheme="system"`).

### Cores fixas

| Nível | Claro | Escuro |
|---|---|---|
| `trace` | `#898781` | `#898781` |
| `debug` | `#1baf7a` | `#199e70` |
| `info` | `#2a78d6` | `#3987e5` |
| `warn` | `#eda100` | `#c98500` |
| `error` | `#e34948` | `#d03b3b` |
| `fatal` | `#6250d6` | `#9085e9` |

- Validadas para contraste e daltonismo nos fundos claro e escuro.
- O nível nunca aparece só como cor: na tabela é um ponto colorido **com o nome**, e o gráfico tem legenda. Isso cobre `debug` e `warn`, que ficam abaixo de 3:1 no fundo branco.
- Linhas de `error` e `fatal` têm fundo com 10% da cor do nível.
- **Gráficos:** 8 cores em ordem fixa (`chart-1` a `chart-8`); a cor acompanha a série mesmo quando um filtro esconde outras.
- **ECharts:** importação modular (`echarts/core`) e um tema gerado em tempo de execução a partir dos tokens do CSS (`--chart-*`, `--level-*`), trocado junto com claro e escuro. O modo `aria` e as texturas (decal) do ECharts ficam ligados, além da legenda e da tabela alternativa.
- **Ambientes (padrão, editável):** `production` vermelho, `staging` amarelo, `development` verde.

---

## 13. Idiomas

- **Idiomas suportados:** português (pt-BR), inglês (en) e espanhol (es). O inglês é o idioma de origem e o fallback.
- **Dashboard:** `next-intl`. O idioma vem da preferência salva no perfil (`users.locale`) ou, no primeiro acesso, do navegador. Datas e números usam `Intl`, no idioma e no fuso do usuário.
- **E-mails:** templates do React Email nos três idiomas, enviados no idioma de cada usuário.
- **Documentação:** Starlight com i18n nativo (`/`, `/pt-br/`, `/es/`).
- **README:** `README.md`, só em inglês. As versões em português e espanhol foram removidas em 05/11/2026 (ADR [0017](adr/0017-licenca-proprietaria-e-repositorio-privado.md)): com o repositório privado, o README deixou de ser vitrine e virou documento interno, lido por um grupo só. A regra dos três idiomas continua valendo inteira para o que o cliente lê — site, documentação, dashboard e e-mails —, que é o que a [0011](adr/0011-tres-idiomas.md) queria de fato.
- **Código, commits, branches e PRs:** em inglês. Issues em português e espanhol são bem-vindas.
- **Mensagens do SDK** (avisos no console): só em inglês.
- **Qualidade:** um teste no CI falha se uma chave de tradução existir num idioma e faltar em outro.

---

## 14. Segurança

Segurança é prioridade em todas as camadas: a plataforma recebe dados de terceiros, guarda credenciais e publica pacotes que rodam nas aplicações de outras pessoas.

### 14.1 Processo

- **Modelo de ameaças** (STRIDE) em [docs/security/threat-model.md](security/threat-model.md), revisado a cada marco.
- **Checklist OWASP ASVS nível 2** para autenticação, sessão, controle de acesso, validação de entrada e configuração.
- **PRs sensíveis:** os que tocam `internal/auth`, `apps/ingest` ou permissões recebem o label `security` e passam por um checklist próprio antes do merge.
- **`SECURITY.md`** com o private vulnerability reporting do GitHub, prazo de resposta e reconhecimento público de quem reportar.
- **Runbooks** em [docs/runbooks/](runbooks/README.md): [incidente](runbooks/incidente.md), [vazamento de key](runbooks/vazamento-de-key.md), [rotação de segredos](runbooks/rotacao-de-segredos.md) (senhas do ClickHouse e do Postgres, `ENCRYPTION_KEY`, segredo de webhook, credenciais do bucket de backup, tokens de provedor e `TF_ENCRYPTION`) e [restauração de backup](runbooks/restauracao-de-backup.md).

### 14.2 Dependências, repositório e publicação

- **Contas:** passkey ou chave de segurança no GitHub, no npm, no Cloudflare, na Hostinger e na Resend — que são todas as que restaram.
- **Publicação no npm:** só pelo GitHub Actions, com trusted publishing (OIDC, sem token guardado) e provenance; campo `files` em cada `package.json`, para publicar só o build.
- **Instalação de dependências:** pnpm 10, que não roda scripts de instalação de dependências por padrão (exceções explícitas em `onlyBuiltDependencies`); `minimumReleaseAge` de alguns dias no pnpm e no Renovate, para não instalar versões recém-publicadas; `--frozen-lockfile` no CI.
- **Poucas dependências:** SDKs sem nenhuma; servidor com o mínimo possível.
- **Verificações automáticas:** Dependabot alerts, Renovate e o workflow `Supply chain`, que roda `pnpm audit` e a política de licenças em todo PR. O `dependency-review-action`, o CodeQL e o OpenSSF Scorecard **foram removidos** em 06/11/2026: os dois primeiros exigem GitHub Advanced Security em repositório privado e o terceiro lê repositório público, consequência já prevista na ADR [0017](adr/0017-licenca-proprietaria-e-repositorio-privado.md). A análise estática de taint do CodeQL **não tem substituto** — ver `docs/security/README.md`.
- **Segredos no repositório:** secret scanning com push protection e padrões próprios para `nekolog_sk_` e `nekolog_pk_`; `.env` nunca vai para o Git (só `.env.example`).
- **GitHub Actions:** actions fixadas por SHA; `permissions` mínimas (`contents: read` por padrão); `step-security/harden-runner`; nada de `pull_request_target` executando código de fork; deploy de produção num environment protegido.
- **Commits assinados** (chave SSH), exigidos na `main` e na `qa`.
- **Releases** com SBOM (CycloneDX) anexado.

### 14.3 Aplicação

- **Logs são entrada não confiável.** Qualquer pessoa com uma key pública pode mandar qualquer texto. Toda renderização escapa o conteúdo; nada de `dangerouslySetInnerHTML`; links dentro de logs não são clicáveis por padrão; sequências ANSI são removidas ou renderizadas com segurança; a exportação em CSV é protegida contra injeção de fórmulas.
- **Cabeçalhos:** CSP com nonce, HSTS com preload, `frame-ancestors 'none'`, `Referrer-Policy`, `Permissions-Policy` e `X-Content-Type-Options`.
- **Controle de acesso:** permissão checada no servidor em toda rota e toda query, com testes de acesso indevido entre organizações (IDOR) e de isolamento no ClickHouse.
- **SQL** sempre parametrizado; o parser da busca e o validador de payload passam por fuzzing.
- **Webhooks dos alertas (SSRF):** só HTTPS, bloqueio de IPs privados, de loopback e do endereço de metadata da nuvem, sem seguir redirecionamentos e com timeout curto.
- **Upload de source maps:** tamanho máximo, tipo validado e nomes de arquivo normalizados (sem `../`).
- **Segredos guardados no banco** (URLs de webhook, tokens do Slack): criptografados com AES-256-GCM, com a chave fora do banco e rotação prevista.
- **Abuso:** Turnstile, rate limits, cotas e re-autenticação para ações críticas (seções 11 e 15).
- **Eventos de segurança** (muitas senhas erradas, reuso de refresh token, key revogada ainda em uso) vão para o audit log e geram alerta para o operador.

### 14.4 Infraestrutura

- **Só o proxy publica porta:** 80 e 443, do Caddy. O ClickHouse, o Postgres e os três apps existem só na rede dos containers, e um teste falha se o compose publicar outra.
- **SSH** só por chave, sem login de root, com firewall e atualizações automáticas (`unattended-upgrades`) na máquina. **Isto é o item B2 de [COMERCIAL.md](COMERCIAL.md) e ainda não foi feito** — a máquina não existe. Enquanto não for, a ameaça E9 do modelo está marcada como parcial.
- **Containers rodam sem root**, e a imagem dos sites roda como `node`.
- **Segredos** no `.env` da máquina, gerado com valores novos pelo `up.sh` e nunca versionado, e nos *environments* do GitHub para o que o CI precisa.
- **Backups criptografados** com `age` antes de saírem da máquina, para um bucket que não é dela.
- **DNS:** DNSSEC no `nekolog.io`; SPF, DKIM e DMARC no envio de e-mail (seção 15.4).

### 14.5 Testes de segurança

- Os testes de autenticação da seção 11.11.
- Testes de IDOR e de isolamento entre organizações.
- Fuzzing do validador de payload e do parser da busca.
- Varredura do OWASP ZAP contra a ingestão e a API, à mão, com a superfície descrita em [docs/security/zap/](security/zap/README.md) e as exceções registradas em arquivo, não na memória de ninguém.
- Teste automático dos cabeçalhos de segurança.
- Antes da 1.0: revisão completa com o ASVS nível 2 e varredura completa do ZAP.

---

## 15. Operação

### 15.1 Instância hospedada por convite

- Contas só nascem de convites: do operador (para novas organizações) ou de membros de uma org (para a própria org).
- **Cotas por organização:** 10 mil eventos por dia e retenção máxima de 7 dias, ajustáveis por organização na área do operador. Projetos e membros não têm limite.
- **Área do operador** (`/operator`, só para usuários com `is_operator`, sempre pedindo a senha de novo; vê uso, nunca o conteúdo dos logs): convites da instância, uso por organização, ajuste das cotas e suspensão de usuários e organizações.
- A **demo pública** somente leitura continua aberta (seção 10).
- **LGPD:** termos de uso e política de privacidade nos três idiomas, exclusão de conta e exportação dos dados pelo próprio usuário.
- **Cadastro self-serve** é o item C9 de [COMERCIAL.md](COMERCIAL.md); até lá, convite é o único caminho.

### 15.2 Monitoramento do próprio NekoLog

- **Endpoint `/health`** em ingest, api, jobs e web, com a versão de cada app.
- **Monitor externo:** Better Stack (plano gratuito), com página de status pública. É o item B12 e ainda não aponta para nada.
- **Heartbeat dos jobs:** a cada execução, os jobs avisam o monitor externo — e avisam num endereço **diferente** quando a execução falhou, para um cron morto e uma tarefa quebrada não serem o mesmo sinal.
- **Alertas** de disco acima do limite, de ClickHouse fora do ar e de lotes acumulados na contingência. A regra em todos: **"não consegui medir" é crítico**, porque leitura de disco que falhou não é disco saudável.
- **Alertas críticos por canal externo** (e-mail e Discord), porque o NekoLog não pode depender de si mesmo para avisar que caiu.
- **Dogfooding:** o NekoLog manda os próprios logs para um projeto `nekolog-self`.

### 15.3 Backups

- `pg_dump` diário do Postgres **pela própria máquina** (container `backup` do `deploy/self-host`), `pg_dump | gzip | age | rclone rcat` num cano só, guardado por 30 dias. Saiu do GitHub Actions em 05/11/2026: o Postgres da VPS não publica porta, então um runner não o alcança sem expor o banco, e os minutos do Actions passaram a ser contados quando o repositório virou privado.
- **Só a metade pública da chave `age` fica na máquina.** Quem entra na máquina alcança o bucket e não lê backup nenhum.
- Teste de restauração a cada marco, **numa máquina diferente da que fez o backup** — é o que exercita a chave privada, que é o ponto de falha mais provável. Continua sendo um `workflow_dispatch` no Actions.
- O Redis não tem backup: códigos e sessões são temporários (no pior caso, todo mundo faz login de novo).
- **O ClickHouse tem backup diário desde 05/11/2026**, e a frase que estava aqui — "os logs são descartáveis; o que não pode se perder está no Postgres" — era verdade num projeto de estudo e deixou de ser no momento em que alguém paga para guardar esses logs. A tarefa `clickhouse-backup` no `apps/jobs` manda `BACKUP DATABASE` para um bucket S3 **fora da máquina**, uma vez por dia UTC, com credencial própria (`nekolog_backup`: só `BACKUP`, `WRITE ON S3` e leitura de `system.backups` — escreve a cópia inteira e **não lê uma linha**).
- Cada backup é completo e independente: sem cadeia incremental, perder um não leva os outros junto. Em troca, ocupa mais espaço.
- **Nada apaga backup velho**, porque o ClickHouse não apaga objeto em S3. A retenção é regra de ciclo de vida no bucket.
- Configurar é opcional e **não configurar é barulhento**: o container de jobs avisa em toda partida que os logs existem num lugar só, e configurar pela metade faz ele se recusar a subir.

### 15.4 E-mail

- Envio por um subdomínio próprio (`mail.nekolog.io`), para proteger a reputação do domínio principal.
- SPF e DKIM configurados pela Resend; DMARC começando em `p=none`, depois `quarantine` e por fim `reject`.
- Webhooks da Resend para acompanhar bounces e reclamações de spam.
- Nos ambientes `dev` e `qa`, e-mails só para uma lista de endereços autorizados, para não gastar a cota de produção.
- **Recebimento:** Cloudflare Email Routing (gratuito) encaminha `security@`, `dmarc@` e `contato@nekolog.io` para o e-mail pessoal do autor.

### 15.5 Infraestrutura como código

- **OpenTofu** (fork open source do Terraform) em `infra/`, com três raízes: `repo` (rulesets do GitHub), `email` (SPF, DKIM, DMARC e o encaminhamento) e `vps` (os registros A da máquina e o bucket de backup). Não há mais raiz por ambiente, porque não há mais recurso por ambiente: a máquina é uma.
- **O que fica no código é o que é de fornecedor.** O que roda *dentro* da máquina é `docker-compose`, não OpenTofu: um compose descreve melhor containers do que um provider descreveria, e é o mesmo arquivo em desenvolvimento e em produção.
- **A máquina em si não está no OpenTofu.** Ela é comprada à mão no hPanel, e o endereço dela entra como variável (`TF_VAR_vps_ipv4`). Declarar a compra de um VPS por código renderia menos do que custa.
- **Estado:** num bucket S3 com a criptografia de estado nativa do OpenTofu, porque o estado contém segredos.
- **Fluxo:** todo PR que muda `infra/` roda `fmt -check` e `validate` nas três raízes; com `INFRA_ENABLED` roda `plan`, e o `apply` roda no merge da `main`, no environment `prod`, que tem aprovação manual. **Nada foi aplicado até hoje** — ver [`infra/README.md`](../infra/README.md).
- **Segredos** nunca aparecem no código; entram por variáveis dos environments do GitHub.
- **Um teste amarra as duas pontas:** `internal/infra` falha se um nome que o proxy atende não tiver registro de DNS, se o prefixo da regra de ciclo de vida se separar do que o backup escreve, ou se uma raiz sob `infra/` ficar de fora do workflow.

---

## 16. Versionamento e compatibilidade

| O quê | Como é versionado |
|---|---|
| Pacotes npm (`@nekolog-io/*`) | SemVer com Changesets; `0.x` até a 1.0; changelog por pacote |
| Apps (`web`, `ingest`, `api`, `jobs`) | também pelo Changesets, como pacotes privados (`privatePackages: { version: true, tag: false }` — sem isso o Changesets os trata como ignorados e recusa qualquer changeset que misture um app com um pacote publicado); a versão aparece no `/health` e no rodapé do dashboard |
| API HTTP | no caminho (`/v1`); uma mudança incompatível vira `/v2`, e a anterior continua por pelo menos 6 meses |
| Payload de ingestão | campo `schemaVersion`; o servidor aceita as duas últimas versões |
| Bancos de dados | migrations numeradas (Drizzle no Postgres, runner próprio em TypeScript no ClickHouse, especificação 3), nunca editadas depois do merge |
| Scripts Lua | carregados por hash (`EVALSHA`) e versionados junto com o código |
| Documentação | uma versão por major |
| Releases | tag e GitHub Release para cada versão, com notas e SBOM |

- **Suporte:** Node 22 ou superior (o 20 saiu de suporte em abril de 2026), Bun e Deno atuais e navegadores no nível "Baseline widely available".
- **Depreciação:** tudo que for removido ganha aviso no console e no changelog pelo menos uma versão minor antes.
- **Correções:** a major atual recebe tudo; a anterior recebe correções de segurança por 6 meses depois de uma nova major.
- **Commits:** Conventional Commits, verificados pelo commitlint, que alimentam os changelogs.
- **A 1.0 saiu na etapa 6.7**, num PR próprio e não pelo PR "Version Packages": eram 68 changesets acumulados sem nenhuma release anterior em que se apoiar. Da 1.0 em diante vale o fluxo da seção 17 sem exceção. O procedimento está em [docs/process/branching.md](process/branching.md).

---

## 17. Fluxo de branches e ambientes

| Branch | O que é | Onde roda | npm |
|---|---|---|---|
| `dev` | desenvolvimento integrado | na máquina de quem está programando, pelo `pnpm dev` | snapshot sob demanda (tag `dev`) |
| `qa` | homologação | nada ainda; **é um ambiente que não existe mais** | snapshot a cada promoção (tag `next`) |
| `main` | produção | a VPS, por `git pull --ff-only` e build na própria máquina (ADR [0018](adr/0018-deploy-por-git-pull-na-maquina.md)) | versão estável (tag `latest`) |

**A `qa` perdeu o ambiente, e isso é uma consequência honesta de uma máquina só.** Antes havia `dev`, `qa` e `prod` separados por conta gratuita; hoje a segunda máquina custaria o mesmo que a primeira. A branch continua existindo como degrau de promoção — o `main` nunca recebe merge direto da `dev` —, mas o que a `qa` validava agora é validado pelo CI e pela pilha local. **Subir uma segunda VPS para `qa` é uma decisão em aberto**, e o custo dela está na tabela B de [COMERCIAL.md](COMERCIAL.md).

**Fluxo:**

1. Cada etapa do [ETAPAS.md](ETAPAS.md) vira uma branch a partir da `dev`, com prefixo `feat/`, `fix/`, `chore/`, `docs/`, `ci/`, `test/`, `security/`, `infra/` ou `a11y/`.
2. PR para a `dev`, com CI verde e changeset quando muda um pacote ou app. Merge por **squash**: cada etapa vira um commit na `dev`, no padrão Conventional Commits.
3. **Promoção para QA:** PR da `dev` para a `qa` com **merge commit** (sem squash, para as branches não divergirem). Roda o e2e completo.
4. **Release:** PR da `qa` para a `main`, também com merge commit. Na `main`, o Changesets abre o PR "Version Packages"; ao mergear, publica no npm e cria as tags. **O deploy não é automático**: alguém roda `deploy.sh` na máquina, e o rollback é manual, por decisão registrada no ADR [0018](adr/0018-deploy-por-git-pull-na-maquina.md).
5. **Sincronização:** depois de cada release, a `main` é mesclada de volta na `qa` e na `dev`, para os números de versão ficarem iguais.
6. **Hotfix:** branch `hotfix/…` a partir da `main`, PR direto para a `main` e depois a mesma sincronização.

**Regras das branches** (rulesets do GitHub):

- **Nas três:** sem push direto, sem force push, sem apagar a branch; CI obrigatório.
- **`main` e `qa`:** commits assinados; um check do CI só aceita PRs da branch anterior (`dev` → `qa`, `qa` → `main`), de `hotfix/…` ou o PR do Changesets.
- **Revisão:** enquanto o projeto tiver uma pessoa só, a aprovação não é obrigatória (o GitHub não deixa aprovar o próprio PR). Quando entrar mais alguém, passa a exigir uma aprovação e o `CODEOWNERS`.

**Separação dentro da máquina:**

A separação que importa não é mais entre ambientes da plataforma, e sim entre **ambientes de cada projeto do cliente** (`production`, `staging`, o que ele criar). Essa continua inteira: a key define o ambiente, o `environment_id` é metade de toda chave estrangeira e de todo filtro, e o nível mínimo, a amostragem, a redação, a retenção e a cota são colunas de `environments` (seção 6).

---

## 18. Estrutura do repositório

Um repositório privado só. O dashboard é o `apps/dashboard`, com o `internal/auth` (senhas, OTP, JWT, sessões) ao lado dos outros pacotes internos.

```
packages/       # destinados ao npm; a publicação está desligada (tabela A)
  core/         # SDKs: core, browser, node, react, next, express, fastify,
  …             # hono, nestjs, pino, winston, cli, bundler-plugin
  db/           # Drizzle + migrations (orgs, projetos, alert_rules…)
  clickhouse/   # migrations, query builder, parser da busca
  adapters/     # KeyStore, RateLimiter, BlobStore, Mailer, RedisClient
  config/       # schemas e carga das variáveis de ambiente
                # Estes quatro são `private: true` e nunca vão ao npm (ADR
                # 0019). Estão em packages/ por história, não por regra:
                # renomeá-los para @internal/* e movê-los para internal/ é
                # etapa própria, porque são 283 ocorrências em 136 arquivos.
apps/
  ingest/       # Hono em Node, num container
  api/          # API pública de leitura: busca, histograma, issues
  jobs/         # alertas, issues, uso e cotas
  web/          # site público (landing page), tema, i18n — não é o dashboard
  dashboard/    # o dashboard: Next.js, internal/auth, as telas do M2 ao M6
  docs/         # Starlight (i18n nativo)
internal/       # não publicados: só fazem sentido dentro deste repositório
  schema/       # formato do payload (SDK ↔ ingest); publicado quando alguém
                # de fora precisar dele
  spool/        # formato da contingência entre ingest e jobs
  seed/         # cria org, projeto, ambientes e keys antes de existir o dashboard
  tracking/     # projeta o docs/ETAPAS.md no GitHub (milestones e issues)
  infra/        # confere o que está declarado em infra/ contra o que roda
  self-host/    # os adaptadores de arquivo que guardam o spool e os bloqueios
  security-headers/ # uma política de cabeçalhos, lida pelo site, pela doc e pelas APIs
  backup/       # nomes, retenção e verificação do dump cifrado
  load/         # scripts do k6, o corpus que eles mandam e os limites da plataforma
  compat/       # a matriz de runtimes, rodada sobre o dist e não sobre o fonte
  release/      # o SBOM de cada pacote publicado e a conferência da release
examples/       # express, nestjs, next, react-vite (também nos testes e2e)
deploy/         # docker-compose (dev e self-host), Caddyfile, Dockerfiles
infra/          # OpenTofu: repositório, e-mail e os nomes da máquina
docs/adr/       # registro das decisões de arquitetura
docs/security/  # modelo de ameaças e checklists
docs/runbooks/  # incidentes, rotação de segredos, restauração de backup
docs/process/   # fluxo de branches e de release
docs/specs/     # especificações técnicas (payload, busca, fingerprint, alertas…)
```

## 19. Ferramentas, CI e publicação

- **Base:** pnpm workspaces + Turborepo, build dos pacotes com tsdown, Biome, Vitest e Playwright.
- **Em todo PR:** lint, typecheck, testes, `publint` e `@arethetypeswrong/cli`, `size-limit` no SDK de browser, testes de integração com ClickHouse, Postgres e Redis como *services* do GitHub Actions, e2e com os `examples/`.
- **Release:** snapshots na `dev` e na `qa` e versão estável na `main`, publicadas com trusted publishing (OIDC) e provenance (seções 16 e 17). Publicar no npm já cobre yarn, pnpm e bun.
- **Deploy:** `deploy/self-host/deploy.sh` na máquina — `git pull --ff-only`, build local e `docker compose up`. O CI não publica nada: ele valida. Um build que falha não derruba o que está no ar; um build que dá certo com código ruim derruba, e o script imprime o comando de volta (ADR [0018](adr/0018-deploy-por-git-pull-na-maquina.md)).
- **Segurança no CI:** seção 14.2.
- **Compatibilidade:** testes em Node 22, 24 e 26, Bun e Deno, e no Chromium, Firefox e WebKit.
- **Antes da 1.0:** teste de carga com k6 — feito na etapa 6.4, em `internal/load`. O que ele mediu está no `internal/load/README.md`; o que mudou por causa dele está abaixo.

### 19.1 O orçamento de CPU da ingestão (medido na 6.4)

Os 10 ms de CPU por request (seção 4) são o limite mais apertado deste projeto,
e **o lote máximo que a especificação 1 permite não cabia neles**. Medido em
2026-11-04: um lote de 500 eventos com 20% de erros, comprimido e com todas as
regras de redação ligadas, custava **10,8 ms**.

Quando isso foi medido, os 10 ms eram o teto de CPU do Cloudflare Workers no
plano gratuito. A VPS não impõe teto nenhum — e o número ficou, porque virou
outra coisa: é **1 vCPU dividido** entre o ClickHouse, o Postgres, quatro
processos Node e o proxy, então CPU gasta na ingestão é CPU tirada do banco que
ela mesma vai consultar. O teto agora é auto-imposto, e `CPU_BUDGET_MS` em
`internal/load` é onde ele mora.

Duas mudanças saíram daí.

- **O fingerprint é memoizado por lote.** Os 100 `crypto.subtle.digest` de um
  lote custavam 1,2 ms, e num *burst* — que é a forma que um incidente tem — são
  todos o mesmo erro. A memoização é por lote, nunca global: um isolate que vive
  muito guardaria um mapa que só cresce. O pior caso (todo erro distinto) não
  piora.
- **O padrão do SDK passou a ser 200 eventos por lote**
  (`DEFAULT_MAX_BATCH_EVENTS` em `@nekolog-io/core`), não 500. O limite do
  protocolo continua 500: o servidor aceita de quem pedir, mas o cliente padrão
  não manda mais o pior caso sem ninguém ter escolhido isso. 200 eventos custam
  ~2,1 ms, o que deixa folga de verdade.

Mesmo depois das duas, o lote de 500 custa 9,1 ms. **Não sobra folga no lote
máximo**, e isso é deliberado: quem pede 500 está pedindo o limite.

Nada disso foi desfeito quando a plataforma mudou. Memoizar o fingerprint e
mandar 200 eventos por padrão continuam sendo melhor engenharia num servidor
que divide um núcleo com o próprio banco do que eram num Worker.

A redação **não** foi otimizada, embora seja o segundo maior custo (1,7 ms sobre
3.000 valores de atributo). Toda otimização plausível ali é uma heurística que
pula valores, e um controle de privacidade que silenciosamente deixa de redigir
é pior que um que redige demais — a mesma regra da seção 14.

## 20. Licença e distribuição

> Esta seção era "Open source" e descrevia um projeto MIT com arquivos de
> comunidade e divulgação pública. A ADR [0017](adr/0017-licenca-proprietaria-e-repositorio-privado.md)
> substituiu a [0002](adr/0002-open-core-com-dashboard-fechado.md) em 05/11/2026:
> o projeto é privado e pago. O histórico do que havia aqui está no git.

- **Licença proprietária**, todos os direitos reservados, com **uma concessão
  estreita**: os pacotes de SDK podem ser instalados, usados e redistribuídos
  sem modificação como componente da aplicação de quem contrata, apenas para
  mandar telemetria ao serviço. Sem essa concessão o produto seria inutilizável,
  não protegido. O servidor, as bibliotecas compartilhadas e a infraestrutura não
  têm concessão nenhuma.
- **Repositório privado.** O código-fonte não é entregue a ninguém.
- **O cliente recebe duas coisas:** a lib, de um registro, e um login no
  dashboard hospedado. Ele nunca roda o servidor, então o self-host deixa de ser
  funcionalidade e vira a ferramenta de deploy da própria instância.
- **MIT histórica:** o texto que valeu até o commit `966f509` fica em
  `LICENSES/MIT-historical.txt`. Não é revogável para o material que cobriu, e
  nenhum pacote chegou a ser publicado sob ela.
- **Arquivos na raiz:** `README.md` (interno, em inglês), `LICENSE` e
  `SECURITY.md`. O `CONTRIBUTING.md` e o `CODE_OF_CONDUCT.md` foram removidos —
  o primeiro descreve contribuição externa que não existe, e o fluxo de trabalho
  já mora em [docs/process/branching.md](process/branching.md); o segundo governa
  uma comunidade que não existe.
- **O `SECURITY.md` não é mais lido por ninguém de fora**, porque o repositório
  é privado. A política continua valendo e a cópia que o cliente lê precisa ir
  para o site. O *private vulnerability reporting* do GitHub deixou de ser opção:
  é recurso de repositório público.
- **ADRs** em [docs/adr/](adr/README.md), cobrindo as decisões arquiteturais da
  seção 1.
- **Divulgação:** não há. Sem presença pública a distribuição é por convite, e o
  `docs/launch/` foi removido em 05/11/2026: o texto afirmava MIT, open-core e
  self-host em quase todo parágrafo, e os dois destinos que ele tinha — dev.to e
  TabNews — deixaram de fazer sentido para um produto fechado. Ele está no
  histórico do git se um dia houver o que anunciar.
- **O que falta para cobrar** está em [COMERCIAL.md](COMERCIAL.md), com esforço
  por item.

---

## 21. Marcos

O passo a passo de cada marco, etapa por etapa e com o nome de cada branch, está em [ETAPAS.md](ETAPAS.md).

| Marco | Entrega | Pronto quando |
|---|---|---|
| **M0 — Fundação** | repositório com `main`, `qa` e `dev` e suas regras, monorepo, CI, base de segurança (seção 14.2), licenças, docker-compose de dev (ClickHouse, Postgres, Valkey, Mailpit, Garage), dashboard e docs vazios com tema Grafite nos três idiomas, primeiros ADRs e modelo de ameaças | `pnpm dev` sobe tudo e o CI passa nas três branches |
| **M1 — Ingestão** | formato do payload v1, `core` + `node`, ingest com contingência, jobs, tabelas no ClickHouse, keys por ambiente via script, limites e cotas, infraestrutura em OpenTofu | um `log.info()` no exemplo Express aparece no ClickHouse de `dev` |
| **M2 — Plataforma** | `internal/auth` (seção 11), convites, área do operador, orgs, projetos, ambientes, keys, Explorer, gráfico de volume, termos e privacidade, monitoramento, backups, e-mail com SPF/DKIM/DMARC | alguém convidado cria conta, entra com código, gera uma key e vê seus logs em produção |
| **M3 — Front e integrações** | `browser`, `react`, `next`, `express`, `fastify`, `hono`, `nestjs`, `pino`, `winston`, breadcrumbs, `traceparent`, trace view, matriz de compatibilidade, `cli init` e passo a passo do primeiro log | um clique no front e a request no back aparecem na mesma linha do tempo |
| **M4 — Investigação** | linguagem de busca, views salvas, tempo real, contexto, issues, releases e source maps, aviso de relógio, exportação, dashboards customizáveis | um erro minificado aparece com arquivo e linha originais |
| **M5 — Alertas e governança** | alertas e canais (com proteção contra SSRF), configurações por ambiente, remoção de dados no servidor, uso e cotas, audit log, alertas de segurança, API pública, rotação de chaves | um pico de erros em `production` gera alerta no Discord em ~1 min |
| **M6 — 1.0** | endpoint OTLP, a pilha inteira num `docker compose up`, docs completas nos três idiomas, teste de carga, revisão de segurança (ASVS nível 2 + ZAP), auditoria de acessibilidade | a pilha sobe seguindo só a documentação |

**Depois da 1.0:** Helm chart, SDKs para React Native/Expo, Vue e Svelte, traces e métricas completos, session replay (rrweb), detecção de anomalias e um servidor MCP para consultar os logs com IA direto do editor.

---

## 22. Riscos e limites

| Risco | Mitigação |
|---|---|
| **A máquina é uma só, e o disco é dela** | backup diário do ClickHouse e do Postgres para um bucket que não é da máquina; o teste de restauração continua sendo o item que falta |
| **1 vCPU dividido com o banco** | teto auto-imposto de 10 ms de CPU por request, guardado por teste; lote padrão de 200 eventos; teto de memória do ClickHouse menor que o do container, para consulta grande falhar em vez de matar o processo |
| **A `qa` não tem ambiente** | o que ela validava passou para o CI e para a pilha local; subir uma segunda máquina é decisão em aberto (seção 17) |
| **O deploy e o rollback são manuais** | aceito no ADR [0018](adr/0018-deploy-por-git-pull-na-maquina.md): build que falha não derruba nada, e o script imprime o comando de volta |
| **A máquina ainda não foi endurecida** | item B2 de [COMERCIAL.md](COMERCIAL.md); até lá, a ameaça E9 do modelo está marcada como parcial, e não como fechada |
| Resend com 100 e-mails/dia | refresh token espaça os logins |
| `.io` mais caro e com futuro incerto (acordo entre Reino Unido e Maurício) | o nome `nekolog-io` vale com qualquer domínio; `nekolog.dev` fica como reserva |
| ClickHouse fora do ar | contingência num volume e reenvio pelos jobs, com deduplicação por `<environmentId>:<batchId>` |
| Bots esgotando a cota de e-mail | instância por convite e Turnstile |
| Exportações agendadas gastando a cota de e-mail | no máximo uma por dia por projeto |
| Autenticação feita à mão | checklist OWASP ASVS, testes extensos e revisão |
| **Minutos do GitHub Actions passaram a ser contados** | o repositório é privado; o backup do Postgres saiu do Actions para a máquina, e o que sobrou lá é validação |

## 23. Fontes

- [ClickHouse Cloud sem plano gratuito permanente](https://dev.to/beton/clickhouse-pricing-teardown-2026-209h)
- [Plano gratuito da Resend](https://automationatlas.io/answers/resend-free-tier-explained-2026/)
- [Better Auth – Sessões](https://www.better-auth.com/docs/concepts/session-management) e [2FA](https://www.better-auth.com/docs/plugins/2fa) (motivo da troca)
- [Auth0 – Rotação de refresh token](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation)
- [RFC 9700 – Boas práticas de segurança OAuth 2.0](https://www.rfc-editor.org/rfc/rfc9700)
- [Preço do .io no Cloudflare (domainoffer)](https://domainoffer.net/tld/io/cloudflare) e [comparativo (CostGoat)](https://costgoat.com/compare/domains/io)
