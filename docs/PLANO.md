# NekoLog — plano do projeto

> Plataforma de logs open source · site `nekolog.io` · npm `@nekolog-io` · GitHub `nekolog-io` · Atualizado em 29/10/2026
>
> Documentos: [ETAPAS.md](ETAPAS.md) (ordem de execução) · [ESPECIFICACOES.md](ESPECIFICACOES.md) (contratos técnicos)

Uma plataforma de logs para aplicações JavaScript/TypeScript, no front-end e no back-end: SDKs publicados no npm, uma API que recebe os logs, armazenamento analítico e um dashboard com filtros, gráficos e projetos, com keys separadas por ambiente.

É um projeto pessoal, de estudo e open source. Roda só em serviços gratuitos na nuvem e também pode ser hospedado por conta própria com Docker.

---

## 1. Decisões tomadas

| Tema | Decisão | Motivo |
|---|---|---|
| Nome | NekoLog: site `nekolog.io`, escopo `@nekolog-io` no npm, org `nekolog-io` no GitHub | `@nekolog` e `nekolog` já estavam ocupados; o mesmo nome nos três lugares |
| Modelo | Open source, projeto pessoal de estudo | Liberdade de escolhas e portfólio |
| Escopo | Plano completo até a 1.0, executado em marcos | Evita retrabalho de arquitetura depois do MVP |
| Hospedagem | Só serviços gratuitos; o único gasto é o domínio `nekolog.io` (~US$ 50/ano no Cloudflare) | Projeto de estudo; o domínio é exigido pela Resend e pelo Cloudflare Tunnel |
| Logs | ClickHouse numa VM Oracle Always Free | Banco colunar, rápido em agregações; o ClickHouse Cloud só tem trial |
| Metadados | Neon Postgres | Gratuito, gerenciado, com backups |
| Ingestão | Hono no Cloudflare Workers (e em Node no self-host) | Mesmo código nos dois ambientes |
| Keys | Por ambiente, públicas (`pk`) e secretas (`sk`) | A key define o ambiente; o SDK não precisa informar |
| Autenticação | Módulo próprio (`internal/auth`), sem Better Auth | O Better Auth não tem refresh token com rotação e não gera código alfanumérico no 2FA |
| Login | E-mail + senha + código alfanumérico de 6 caracteres por e-mail, em todo login | Segundo fator obrigatório |
| Códigos e sessões | Redis (Upstash na nuvem, Redis/Valkey no self-host) | Dados temporários; o TTL faz a limpeza |
| Sessão | Access token JWT de 10 min + refresh token que muda a cada uso, com detecção de reuso | Pedido explícito; detecta token copiado |
| Tema visual | Paleta Grafite, com tema claro e escuro | Interface neutra deixa a cor para os níveis de log |
| Instância hospedada | Só por convite, com Turnstile, cotas e área do operador | Protege as cotas gratuitas e evita responder por dados de qualquer pessoa |
| Idiomas | Dashboard, docs, e-mails e README em português (pt-BR), inglês e espanhol; código, commits, branches e PRs em inglês | Alcance internacional e diferencial para a comunidade latina |
| Segurança | Prioridade máxima em todas as camadas (seção 14) | A plataforma recebe dados de terceiros e publica pacotes que rodam em outras aplicações |
| Versionamento | Tudo versionado: pacotes, apps, API, payload, migrations e docs (seção 16) | Atualizações previsíveis para quem usa e para quem hospeda |
| Branches | `main` (produção), `qa` (homologação) e `dev` (desenvolvimento), com uma branch por etapa (seção 17) | Histórico organizado e promoção controlada entre ambientes |
| Licença | MIT em todo o repositório (SDKs e plataforma) | Simples e permissiva; projeto de estudo e portfólio |
| Infraestrutura | Como código, com OpenTofu, a partir do M1 (seção 15.5) | Tudo recriável, versionado e revisado em PR |
| Acompanhamento | Cada etapa é uma issue no GitHub, dentro do milestone do seu marco | Cada PR fecha uma issue; o histórico fica rastreável |
| Cotas da instância hospedada | 10 mil eventos por dia por organização e retenção de 7 dias, ajustáveis pelo operador; projetos e membros sem limite | Cabe nas cotas gratuitas e pode crescer depois |
| Exportação de logs | JSON, XML e CSV, manual ou agendada, avisada por e-mail com link autenticado | Guardar logs além da retenção sem expor dados por e-mail |
| Papéis | 4 papéis fixos por organização: owner, admin, member e viewer (seção 10.2) | Simples de entender, de implementar e de testar |
| Telas | Mapa de telas no plano (seção 10.1); mockups HTML aprovados antes do M2 | Decidir navegação e fluxo antes de programar |
| Ferramentas | Gráficos com ECharts, validação com Valibot, migrations do ClickHouse com runner próprio e monitor externo Better Stack | Desempenho com muitos pontos, leveza no Worker, simplicidade e heartbeat com página de status |

## 2. Decisões em aberto

- **Reservar o quanto antes:** a org `nekolog-io` no npm e no GitHub (gratuitas) e o domínio `nekolog.io` pelo Cloudflare Registrar, que já deixa o DNS pronto para o Tunnel e a Resend. Os três estavam livres em 29/10/2026.
- **Logo e ícone:** o autor vai criar e adicionar depois; até lá, o projeto usa o nome em texto.
- **Mockups das telas:** aprovação antes do M2 (etapa 2.1).

---

## 3. Princípios

1. **Ingestão leve, processamento pesado fora dela.** A API só valida e grava. Agrupamento de erros, source maps e alertas rodam em outro lugar.
2. **Mesmo código na nuvem e no self-host.** Tudo que depende de fornecedor fica atrás de uma interface (`KeyStore`, `RateLimiter`, `BlobStore`, `Mailer`, `LogStore`, `RedisClient`).
3. **O SDK nunca quebra a aplicação** e não tem dependências.
4. **Padrões abertos:** formato de log do OpenTelemetry e propagação via `traceparent` (W3C).
5. **Privacidade por padrão (LGPD):** dados sensíveis são removidos no SDK e no servidor; o IP não é guardado, só o país.

---

## 4. Arquitetura

```
SDKs (browser / node)
   │ HTTPS, lotes com gzip
   ▼
Cloudflare Worker "ingest" (Hono)
   ├─ Workers KV ....... key → projeto + ambiente + regras + bloqueio por cota
   └─ insert ──(Tunnel)──► ClickHouse na VM Oracle Always Free (logs)
                                  ▲
Cloudflare Worker "jobs" ◄─ Cron a cada 1 min
   ├─ alertas, issues, uso, cotas ─┤
   └─► Resend / Slack / Discord / webhook
                                  │
Vercel: dashboard Next.js ────────┘
   ├─► Neon Postgres (usuários, orgs, projetos, ambientes, keys, alertas)
   ├─► Upstash Redis (códigos, sessões, rate limit da autenticação)
   └─► Resend (códigos de login, convites, avisos)

Cloudflare R2: source maps
```

- **A ingestão não depende do Postgres nem do Redis.** As keys ficam copiadas no KV, então o Neon (que hiberna depois de 5 min parado) nunca adiciona latência, e o orçamento do Upstash fica todo para a autenticação.
- **Fila desligada por padrão.** O `async_insert` do ClickHouse já agrupa os inserts no servidor. O Cloudflare Queues fica como adaptador opcional.
- **Exposição do ClickHouse:** pelo Cloudflare Tunnel, sem abrir portas na VM.
- **Dois usuários no ClickHouse:** um só com `INSERT` (ingestão) e outro só com `SELECT` (dashboard e jobs).
- **A VM é descartável.** Ela é recriada por script (cloud-init + docker-compose). Os dados que não podem ser perdidos (usuários, keys) ficam no Neon.
- **Endereços:** `nekolog.io` (site e docs), `app.nekolog.io` (dashboard), `ingest.nekolog.io` (Worker de ingestão) e `ch.nekolog.io` (ClickHouse pelo Tunnel, protegido pelas credenciais do ClickHouse e, de preferência, por um token de serviço do Cloudflare Access). Os ambientes `dev` e `qa` têm endereços próprios (seção 17).

### Serviços gratuitos

| Peça | Serviço | Limite que importa |
|---|---|---|
| Ingestão e jobs | Cloudflare Workers | 100 mil req/dia, 1.000 req/min, ~10 ms de CPU por request |
| Agendamento | Cloudflare Cron Triggers | 5 por conta; um único cron por minuto dispara todas as tarefas |
| Keys na ingestão | Cloudflare Workers KV | 100 mil leituras/dia, 1.000 escritas/dia |
| Fila (opcional) | Cloudflare Queues | 10 mil operações/dia, retenção de 24 h |
| Logs | ClickHouse na VM Oracle Always Free (ARM) | 2 OCPU + 12 GB de RAM (cota reduzida em 2026) |
| Plano B para logs | Tinybird Free | 10 GB, 1.000 consultas/dia |
| Metadados | Neon Postgres | 0,5 GB por projeto, 100 CU-h/mês |
| Autenticação | Upstash Redis | 256 MB, 500 mil comandos/mês |
| Dashboard e docs | Vercel Hobby | uso não comercial; cron só 1×/dia |
| Source maps | Cloudflare R2 | 10 GB, download grátis |
| E-mail | Resend | 3.000/mês, 100/dia, exige domínio verificado |
| Exposição da VM | Cloudflare Tunnel | gratuito, exige domínio no Cloudflare |
| Repositório, CI, publicação | GitHub + Actions + npm | gratuito para projeto público |

## 5. Self-host

O mesmo código roda num `docker-compose`, trocando cada serviço gratuito pelo equivalente:

| Nuvem gratuita | Self-host |
|---|---|
| Workers (ingest, jobs) | containers Node com o mesmo app Hono |
| KV | cache em memória + Postgres |
| Upstash Redis | Redis ou Valkey (obrigatório) |
| R2 | MinIO ou disco (mesma API S3) |
| Cron Triggers | agendador dentro do container de jobs |
| Neon / VM Oracle | Postgres e ClickHouse no próprio compose |
| Resend | SMTP qualquer |

No ambiente de desenvolvimento, o compose também sobe o **Mailpit**, que captura todos os e-mails numa página local.

---

## 6. Projetos, ambientes e keys

**Hierarquia:** Organização → Projeto → Ambiente → Keys

- Todo projeto nasce com `production`, `staging` e `development`. O usuário pode criar outros (`qa`, `preview`…), cada um com uma cor.
- Cada ambiente pode ter várias keys, para rotacionar sem downtime:
  - `nekolog_pk_…` (pública): só envia logs, usada no front.
  - `nekolog_sk_…` (secreta): envia e/ou lê logs pela API, com escopos (`logs:write`, `logs:read`).
- **A key define o ambiente.** O SDK não precisa da opção `environment`, e uma key de staging nunca grava em produção.
- **Configurações por ambiente:** origens permitidas (keys públicas), retenção em dias, nível mínimo aceito, taxa de amostragem, cota diária e regras extras de remoção de dados sensíveis.
- **Segurança das keys:** só o hash SHA-256 é guardado; a key aparece uma única vez; o dashboard mostra o "último uso". Ao criar ou revogar, o dashboard atualiza o KV, e a revogação leva até ~60 s para valer em todo lugar.
- **No browser, a key vai na URL** (`/v1/logs?key=pk_…`), porque o `sendBeacon` não envia headers. No back-end, vai em `Authorization: Bearer sk_…`.

---

## 7. Modelo de dados

### Postgres (Drizzle)

- **Usuários e acesso:** `users`, `organizations`, `memberships` (owner/admin/member/viewer), `invites`
- **Projetos:** `projects`, `environments`, `api_keys`
- **Investigação:** `saved_views`, `dashboards`, `issues` (status, responsável, primeira e última ocorrência), `releases`
- **Alertas:** `alert_rules`, `alert_channels`, `alert_events`
- **Auditoria:** `audit_log`

A tabela `users` tem `id`, `name`, `email` (único, em minúsculas), `password_hash`, `email_verified_at`, `password_changed_at`, `locale`, `timezone`, `is_operator`, `suspended_at` e `created_at`. Sessões e códigos não ficam no Postgres.

### ClickHouse

```sql
CREATE TABLE logs (
  project_id      LowCardinality(String),
  environment_id  LowCardinality(String),
  timestamp       DateTime64(3),
  received_at     DateTime64(3),
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
- A *materialized view* `logs_per_minute` (contagem por projeto, ambiente, nível, serviço e minuto) alimenta os gráficos e o controle de cota.

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

- Remoção de dados sensíveis por padrão: `password`, `token`, `authorization`, `cpf`, números de cartão.
- SDK de browser com meta de menos de 5 KB gzip, verificada no CI com `size-limit`.
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
- **Validação leve com Valibot**, por causa dos 10 ms de CPU do Worker.
- **Resposta imediata e contingência:** a ingestão responde `202` assim que valida o lote e grava em segundo plano (`waitUntil`). Se o insert no ClickHouse falhar, o lote vai para o R2 (`spool/`) e os jobs reenviam quando o ClickHouse voltar, com um token de deduplicação por lote para nada ser gravado duas vezes.
- **Limite de atributos:** no máximo 500 chaves distintas em `attributes` por projeto; chaves novas além disso são descartadas e aparecem no uso.
- **Rate limit sem Redis:**
  - a config da key fica em cache na memória do Worker por 60 s, e um contador por instância segura rajadas;
  - a cota diária é controlada pelos jobs: a cada minuto, eles somam o uso do dia na `logs_per_minute` e, se um ambiente estourar, gravam `blocked: true` no KV. A ingestão passa a responder `429`. O KV só é escrito quando o estado muda.

### Consulta

- O dashboard consulta o ClickHouse pelas rotas do próprio Next.js (usuário só com `SELECT`).
- API pública de leitura com key `sk_` e escopo `logs:read`: busca, histograma e issues.
- **Busca:** sintaxe como `level:error service:api status>=500 "timeout" -env:dev`. Vira uma AST e depois SQL parametrizado. O servidor injeta o filtro de projeto e ambiente em toda query, nunca o usuário. Isso tem testes próprios de isolamento entre projetos. A gramática completa está na especificação 4.

---

## 10. Dashboard

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
- **Relógio do cliente:** o dashboard avisa quando o `timestamp` enviado pelo cliente diverge mais de 5 min do `received_at`.
- **Exportação de logs:**
  - **Formatos:** JSON (NDJSON, um log por linha), XML e CSV (protegido contra injeção de fórmulas).
  - **Manual:** o usuário escolhe filtros e período no Explorer e pede a exportação.
  - **Agendada:** por projeto e ambiente, diária ou semanal, por exemplo para guardar os logs antes de a retenção apagá-los.
  - **Geração:** o próprio ClickHouse gera o arquivo no formato escolhido e grava comprimido no R2 (`INSERT INTO FUNCTION s3(...)`), sem gastar CPU do Worker.
  - **Entrega por e-mail com link, não com anexo:** o e-mail avisa que a exportação está pronta e leva ao dashboard, que exige login e permissão no ambiente antes de liberar o download. Logs podem ter dados sensíveis, anexos ficam para sempre na caixa de e-mail e e-mails têm limite de tamanho.
  - **Validade:** os arquivos ficam 7 dias no R2 e depois são apagados por uma regra de ciclo de vida.
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

Módulo próprio em `internal/auth`, com `@node-rs/argon2`, `jose`, Redis e a API do Pwned Passwords. As rotas em `apps/web/app/api/auth/` são finas e só chamam o módulo.

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

No self-host, o Redis usa `ioredis`; na nuvem, `@upstash/redis` (HTTP, funciona em serverless e aceita `EVAL`). Um adaptador escolhe pelo ambiente (`REDIS_URL` ou `UPSTASH_REDIS_REST_URL`).

### 11.8 E-mail

- Adaptador `Mailer`: Resend na nuvem, SMTP no self-host, Mailpit em desenvolvimento. Templates em React Email.
- A Resend só envia para outras pessoas com domínio verificado. O remetente será `no-reply@nekolog.io`.
- O plano gratuito permite 100 e-mails por dia. Com refresh token, o login com código só acontece a cada 7–30 dias por pessoa, e a demo pública não envia e-mail.
- O envio não bloqueia a resposta (na Vercel, `waitUntil`), para o tempo de resposta não revelar se a senha estava certa.

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
- **README:** `README.md` em inglês, com `README.pt-BR.md` e `README.es.md`.
- **Código, commits, branches e PRs:** em inglês. Issues em português e espanhol são bem-vindas.
- **Mensagens do SDK** (avisos no console): só em inglês.
- **Qualidade:** um teste no CI falha se uma chave de tradução existir num idioma e faltar em outro.

---

## 14. Segurança

Segurança é prioridade em todas as camadas: a plataforma recebe dados de terceiros, guarda credenciais e publica pacotes que rodam nas aplicações de outras pessoas.

### 14.1 Processo

- **Modelo de ameaças** (STRIDE) em `docs/security/threat-model.md`, revisado a cada marco.
- **Checklist OWASP ASVS nível 2** para autenticação, sessão, controle de acesso, validação de entrada e configuração.
- **PRs sensíveis:** os que tocam `internal/auth`, `apps/ingest` ou permissões recebem o label `security` e passam por um checklist próprio antes do merge.
- **`SECURITY.md`** com o private vulnerability reporting do GitHub, prazo de resposta e reconhecimento público de quem reportar.
- **Runbooks** em `docs/runbooks/`: incidente, vazamento de key, rotação de segredos (JWT, HMAC dos códigos, senhas do ClickHouse, tokens de deploy) e restauração de backup.

### 14.2 Dependências, repositório e publicação

- **Contas:** passkey ou chave de segurança no GitHub, npm, Cloudflare, Vercel, Neon, Upstash, Resend e Oracle.
- **Publicação no npm:** só pelo GitHub Actions, com trusted publishing (OIDC, sem token guardado) e provenance; campo `files` em cada `package.json`, para publicar só o build.
- **Instalação de dependências:** pnpm 10, que não roda scripts de instalação de dependências por padrão (exceções explícitas em `onlyBuiltDependencies`); `minimumReleaseAge` de alguns dias no pnpm e no Renovate, para não instalar versões recém-publicadas; `--frozen-lockfile` no CI.
- **Poucas dependências:** SDKs sem nenhuma; servidor com o mínimo possível.
- **Verificações automáticas:** Dependabot alerts, Renovate, `dependency-review-action` (bloqueia PR com vulnerabilidade ou licença incompatível), CodeQL, OpenSSF Scorecard e `pnpm audit`.
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

- **VM sem nenhuma porta de entrada:** tudo passa pelo Cloudflare Tunnel, e a lista de segurança da Oracle nega qualquer entrada.
- **SSH** só por chave, sem login de root, acessível apenas pelo Cloudflare Access ou pelo console da Oracle.
- **Atualizações automáticas de segurança** (`unattended-upgrades`) na VM.
- **ClickHouse e Redis** escutam só na rede interna do Docker; containers rodam sem root.
- **Segredos** só nos cofres de cada serviço (GitHub Environments, Cloudflare, Vercel), separados por ambiente.
- **Backups criptografados** com `age` antes de irem para o R2.
- **DNS:** DNSSEC no `nekolog.io`; SPF, DKIM e DMARC no envio de e-mail (seção 15.4).

### 14.5 Testes de segurança

- Os testes de autenticação da seção 11.11.
- Testes de IDOR e de isolamento entre organizações.
- Fuzzing do validador de payload e do parser da busca.
- Varredura básica do OWASP ZAP contra o ambiente `qa` a cada promoção.
- Teste automático dos cabeçalhos de segurança.
- Antes da 1.0: revisão completa com o ASVS nível 2 e varredura completa do ZAP.

---

## 15. Operação

### 15.1 Instância hospedada por convite

- Em `app.nekolog.io`, contas só nascem de convites: do operador (para novas organizações) ou de membros de uma org (para a própria org).
- **Cotas por organização:** 10 mil eventos por dia e retenção máxima de 7 dias, ajustáveis por organização na área do operador. Projetos e membros não têm limite.
- **Área do operador** (`/operator`, só para usuários com `is_operator`, sempre pedindo a senha de novo; vê uso, nunca o conteúdo dos logs): convites da instância, uso por organização, ajuste das cotas e suspensão de usuários e organizações.
- A **demo pública** somente leitura continua aberta (seção 10).
- **LGPD:** termos de uso e política de privacidade nos três idiomas, exclusão de conta e exportação dos dados pelo próprio usuário.
- **No self-host**, o primeiro usuário vira operador, e o cadastro aberto é uma opção de configuração.

### 15.2 Monitoramento do próprio NekoLog

- **Endpoint `/health`** em ingest, web e jobs, com a versão de cada app e o estado das dependências (ClickHouse, Postgres, Redis).
- **Monitor externo:** Better Stack (plano gratuito) checando os três, com página de status pública.
- **Heartbeat dos jobs:** a cada execução, os jobs avisam o monitor externo; se pararem, o monitor alerta.
- **Alertas** de disco da VM acima de 80%, de ClickHouse fora do ar e de lotes acumulados na contingência do R2.
- **Alertas críticos por canal externo** (e-mail e Discord), porque o NekoLog não pode depender de si mesmo para avisar que caiu.
- **Dogfooding:** o NekoLog manda os próprios logs para um projeto `nekolog-self`.

### 15.3 Backups

- `pg_dump` diário do Postgres pelo GitHub Actions, criptografado com `age` e guardado no R2 por 30 dias.
- Teste de restauração a cada marco, numa branch do Neon.
- O Redis não tem backup: códigos e sessões são temporários (no pior caso, todo mundo faz login de novo).
- Os logs do ClickHouse são descartáveis; o que não pode se perder está no Postgres.

### 15.4 E-mail

- Envio por um subdomínio próprio (`mail.nekolog.io`), para proteger a reputação do domínio principal.
- SPF e DKIM configurados pela Resend; DMARC começando em `p=none`, depois `quarantine` e por fim `reject`.
- Webhooks da Resend para acompanhar bounces e reclamações de spam.
- Nos ambientes `dev` e `qa`, e-mails só para uma lista de endereços autorizados, para não gastar a cota de produção.
- **Recebimento:** Cloudflare Email Routing (gratuito) encaminha `security@`, `dmarc@` e `contato@nekolog.io` para o e-mail pessoal do autor.

### 15.5 Infraestrutura como código

- **OpenTofu** (fork open source do Terraform) a partir do M1, em `infra/`, com um diretório por ambiente (`infra/envs/dev`, `qa` e `prod`) e módulos compartilhados.
- **O que fica no código:** DNS, Tunnel, Access, Turnstile, Email Routing, KV, R2 e rotas dos Workers (provider do Cloudflare); VM e regras de rede (provider da Oracle); projeto e domínios na Vercel; repositório, rulesets e environments no GitHub. Neon e Upstash entram se os providers deles atenderem; senão, ficam documentados em runbook.
- **Estado:** guardado no R2 com a criptografia de estado nativa do OpenTofu, porque o estado contém segredos.
- **Fluxo:** todo PR que muda `infra/` roda `tofu plan` no CI e mostra o plano no PR; o `tofu apply` roda ao mergear, em cada ambiente, com aprovação manual para produção.
- **Segredos** nunca aparecem no código; entram por variáveis dos environments do GitHub.

---

## 16. Versionamento e compatibilidade

| O quê | Como é versionado |
|---|---|
| Pacotes npm (`@nekolog-io/*`) | SemVer com Changesets; `0.x` até a 1.0; changelog por pacote |
| Apps (`web`, `ingest`, `jobs`) | também pelo Changesets, como pacotes privados; a versão aparece no `/health` e no rodapé do dashboard |
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

---

## 17. Fluxo de branches e ambientes

| Branch | Ambiente | Dashboard | Ingestão | npm |
|---|---|---|---|---|
| `dev` | desenvolvimento integrado | `dev.nekolog.io` | `ingest-dev.nekolog.io` | snapshot sob demanda (tag `dev`) |
| `qa` | homologação | `qa.nekolog.io` | `ingest-qa.nekolog.io` | snapshot a cada promoção (tag `next`) |
| `main` | produção | `app.nekolog.io` | `ingest.nekolog.io` | versão estável (tag `latest`) |

**Fluxo:**

1. Cada etapa do [ETAPAS.md](ETAPAS.md) vira uma branch a partir da `dev`, com prefixo `feat/`, `fix/`, `chore/`, `docs/`, `ci/`, `test/`, `security/`, `infra/` ou `a11y/`.
2. PR para a `dev`, com CI verde e changeset quando muda um pacote ou app. Merge por **squash**: cada etapa vira um commit na `dev`, no padrão Conventional Commits.
3. **Promoção para QA:** PR da `dev` para a `qa` com **merge commit** (sem squash, para as branches não divergirem). Roda o e2e completo e a varredura do ZAP no ambiente `qa`.
4. **Release:** PR da `qa` para a `main`, também com merge commit. Na `main`, o Changesets abre o PR "Version Packages"; ao mergear, publica no npm, cria as tags e faz o deploy de produção.
5. **Sincronização:** depois de cada release, a `main` é mesclada de volta na `qa` e na `dev`, para os números de versão ficarem iguais.
6. **Hotfix:** branch `hotfix/…` a partir da `main`, PR direto para a `main` e depois a mesma sincronização.

**Regras das branches** (rulesets do GitHub):

- **Nas três:** sem push direto, sem force push, sem apagar a branch; CI obrigatório.
- **`main` e `qa`:** commits assinados; um check do CI só aceita PRs da branch anterior (`dev` → `qa`, `qa` → `main`), de `hotfix/…` ou o PR do Changesets.
- **Revisão:** enquanto o projeto tiver uma pessoa só, a aprovação não é obrigatória (o GitHub não deixa aprovar o próprio PR). Quando entrar mais alguém, passa a exigir uma aprovação e o `CODEOWNERS`.

**Separação dos ambientes nos serviços gratuitos:**

- **Neon:** uma branch do banco para cada ambiente.
- **ClickHouse:** um database por ambiente (`nekolog_dev`, `nekolog_qa`, `nekolog_prod`) na mesma VM.
- **Workers, KV e R2:** um Worker, um namespace e um bucket por ambiente (`wrangler --env`).
- **Upstash:** um prefixo de chave por ambiente (`dev:`, `qa:`, `prod:`).
- **Vercel:** um domínio por branch.
- **Atenção:** os limites dos planos gratuitos são por conta, então os três ambientes dividem as mesmas cotas (seção 22).

---

## 18. Estrutura do repositório

```
packages/       # publicados no npm: core, browser, node, react, next, express,
                # fastify, hono, nestjs, pino, winston, cli, bundler-plugin
apps/
  ingest/       # Hono → Cloudflare Workers e Node
  jobs/         # alertas, issues, uso e cotas
  web/          # dashboard Next.js (rotas de auth, proxy.ts, tema, i18n)
  docs/         # Starlight (i18n nativo)
internal/       # não publicados
  auth/         # senhas, códigos, tokens, sessões, rate limit, Lua
  schema/       # formato do payload (SDK ↔ ingest)
  db/           # Drizzle + migrations
  clickhouse/   # migrations, query builder, parser da busca
  adapters/     # KeyStore, RateLimiter, BlobStore, Mailer, RedisClient
examples/       # express, nestjs, next, react-vite (também nos testes e2e)
deploy/         # docker-compose (dev e self-host), cloud-init da VM, wrangler
infra/          # OpenTofu: módulos e um diretório por ambiente
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
- **Deploy:** cada branch publica no seu ambiente (seção 17): integração Git da Vercel para web e docs, com preview por PR, e `wrangler deploy --env` pelo Actions para ingest e jobs.
- **Segurança no CI:** seção 14.2.
- **Compatibilidade:** testes em Node 22, 24 e 26, Bun e Deno, e no Chromium, Firefox e WebKit.
- **Antes da 1.0:** teste de carga com k6.

## 20. Open source

- **Licença:** MIT em todo o repositório.
- **Arquivos da comunidade:** `README` em inglês (com versões em português e espanhol), com GIF e quickstart, `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY.md` (com o private vulnerability reporting do GitHub), templates de issue e PR, label `good first issue`, Discussions, roadmap público no GitHub Projects.
- **ADRs** em `docs/adr/`, começando pelas decisões da seção 1.
- **Demo pública** com dados falsos e sessão somente leitura.
- **Divulgação na 1.0:** TabNews, dev.to e Show HN.

---

## 21. Marcos

O passo a passo de cada marco, etapa por etapa e com o nome de cada branch, está em [ETAPAS.md](ETAPAS.md).

| Marco | Entrega | Pronto quando |
|---|---|---|
| **M0 — Fundação** | repositório com `main`, `qa` e `dev` e suas regras, monorepo, CI, base de segurança (seção 14.2), licenças, docker-compose de dev (ClickHouse, Postgres, Valkey, Mailpit, MinIO), dashboard e docs vazios com tema Grafite nos três idiomas, primeiros ADRs e modelo de ameaças | `pnpm dev` sobe tudo e o CI passa nas três branches |
| **M1 — Ingestão** | formato do payload v1, `core` + `node`, ingest (Node e Workers) com contingência no R2, jobs, tabelas no ClickHouse, keys por ambiente via script, limites e cotas, infraestrutura em OpenTofu e VM da Oracle | um `log.info()` no exemplo Express aparece no ClickHouse de `dev` |
| **M2 — Plataforma** | `internal/auth` (seção 11), convites, área do operador, orgs, projetos, ambientes, keys, Explorer, gráfico de volume, termos e privacidade, monitoramento, backups, e-mail com SPF/DKIM/DMARC, deploy nos três ambientes | alguém convidado cria conta, entra com código, gera uma key e vê seus logs em produção |
| **M3 — Front e integrações** | `browser`, `react`, `next`, `express`, `fastify`, `hono`, `nestjs`, `pino`, `winston`, breadcrumbs, `traceparent`, trace view, matriz de compatibilidade, `cli init` e passo a passo do primeiro log | um clique no front e a request no back aparecem na mesma linha do tempo |
| **M4 — Investigação** | linguagem de busca, views salvas, tempo real, contexto, issues, releases e source maps, aviso de relógio, exportação, dashboards customizáveis | um erro minificado aparece com arquivo e linha originais |
| **M5 — Alertas e governança** | alertas e canais (com proteção contra SSRF), configurações por ambiente, remoção de dados no servidor, uso e cotas, audit log, alertas de segurança, API pública, rotação de chaves | um pico de erros em `production` gera alerta no Discord em ~1 min |
| **M6 — 1.0** | endpoint OTLP, self-host com um comando, docs completas nos três idiomas, teste de carga, revisão de segurança (ASVS nível 2 + ZAP), auditoria de acessibilidade, lançamento | alguém sobe tudo seguindo só a documentação |

**Depois da 1.0:** Helm chart, SDKs para React Native/Expo, Vue e Svelte, traces e métricas completos, session replay (rrweb), detecção de anomalias e um servidor MCP para consultar os logs com IA direto do editor.

---

## 22. Riscos e limites

| Risco | Mitigação |
|---|---|
| A Oracle reduz a cota ou recupera a VM | VM recriável por script; Tinybird como plano B (adaptador `LogStore`) |
| 10 ms de CPU no Worker | validação leve; nada pesado na ingestão |
| Neon hiberna após 5 min | a ingestão não consulta o Postgres (keys no KV) |
| Queues com 10 mil operações/dia | fila desligada; `async_insert` do ClickHouse |
| Upstash com 500 mil comandos/mês | Redis só para autenticação; JWT evita consulta a cada request |
| Resend com 100 e-mails/dia | refresh token espaça os logins; demo sem e-mail |
| Vercel Hobby: só uso não comercial e cron 1×/dia | projeto de estudo; jobs no Cloudflare |
| `.io` mais caro e com futuro incerto (acordo entre Reino Unido e Maurício) | o nome `nekolog-io` vale com qualquer domínio; `nekolog.dev` fica como reserva |
| Os três ambientes dividem as mesmas cotas gratuitas (os limites são por conta) | pouco tráfego de teste em `dev` e `qa`; e-mails desses ambientes só para endereços autorizados |
| ClickHouse fora do ar | contingência no R2 e reenvio pelos jobs |
| Perda do Postgres | `pg_dump` diário criptografado no R2, com teste de restauração |
| Bots esgotando a cota de e-mail | instância por convite e Turnstile |
| Worker gratuito faz no máximo 50 subrequests por execução | os jobs agrupam regras e consultas e processam em lotes rotativos (especificação 6) |
| Exportações agendadas gastando a cota de e-mail | no máximo uma por dia por projeto na instância hospedada |
| Autenticação feita à mão | checklist OWASP ASVS, testes extensos e revisão antes da demo |

Os limites dos planos gratuitos foram conferidos em 29/10/2026 e mudam com frequência. Confirme na página oficial antes de depender deles.

## 23. Fontes

- [Cloudflare Queues no plano Free](https://developers.cloudflare.com/changelog/post/2026-02-04-queues-free-plan/)
- [Limites do Cloudflare Workers](https://developers.cloudflare.com/workers/platform/limits/)
- [Corte no Oracle Always Free (InfoQ)](https://infoq.com/news/2026/07/oracle-cloud-free-tier-limits/)
- [ClickHouse Cloud sem plano gratuito permanente](https://dev.to/beton/clickhouse-pricing-teardown-2026-209h)
- [Limites do Tinybird](https://tinybird.co/docs/forward/pricing/limits)
- [Preços do Neon](https://neon.com/pricing)
- [Preços do Upstash Redis](https://upstash.com/pricing/redis)
- [Cron jobs na Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Plano gratuito do R2](https://filebase.com/blog/cloudflare-r2-pricing-costs-savings-and-alternatives-in-2026/)
- [Plano gratuito da Resend](https://automationatlas.io/answers/resend-free-tier-explained-2026/)
- [Better Auth – Sessões](https://www.better-auth.com/docs/concepts/session-management) e [2FA](https://www.better-auth.com/docs/plugins/2fa) (motivo da troca)
- [Auth0 – Rotação de refresh token](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation)
- [RFC 9700 – Boas práticas de segurança OAuth 2.0](https://www.rfc-editor.org/rfc/rfc9700)
- [Preço do .io no Cloudflare (domainoffer)](https://domainoffer.net/tld/io/cloudflare) e [comparativo (CostGoat)](https://costgoat.com/compare/domains/io)
