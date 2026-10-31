# NekoLog — etapas de implementação

> Complementa o [PLANO.md](PLANO.md): o plano diz **o quê** e **por quê**; este arquivo diz **em que ordem**, etapa por etapa. Os contratos técnicos estão em [ESPECIFICACOES.md](ESPECIFICACOES.md). Atualizado em 29/10/2026.

## Como usar

- **Uma etapa = uma issue = uma branch a partir da `dev` = um PR.** Cada etapa é uma issue no milestone do seu marco (M0 a M6); o nome da branch está ao lado de cada etapa, e o PR fecha a issue com `Closes #N`.
- **Commits em inglês, no padrão Conventional Commits**, com o pacote ou app como escopo:

  ```
  feat(core): add batching transport
  fix(ingest): reject payloads above 512 KB
  test(auth): cover refresh token reuse
  docs(sdk): add express guide in pt-BR and es
  ```

- Faça vários commits pequenos durante a etapa. No merge para a `dev`, o squash junta tudo num commit com o título do PR, então o histórico da `dev` fica com uma linha por etapa.
- **Uma etapa só é mergeada quando:**
  - o CI está verde (lint, tipos, testes e verificações de segurança);
  - há testes novos cobrindo o que mudou;
  - há um changeset, se mudou um pacote ou app;
  - os textos de interface existem nos três idiomas;
  - a documentação foi atualizada, se mudou algo público;
  - o checklist de segurança foi seguido, se o PR tem o label `security`.
- **Promoções:** ao fim de cada marco (ou antes, se fizer sentido), PR `dev` → `qa` e depois `qa` → `main`, como na seção 17 do plano.
- Marque `[x]` ao concluir cada etapa.

## Antes do primeiro commit (tarefas manuais)

- [ ] Criar a org `nekolog-io` no GitHub e no npm.
- [ ] Registrar `nekolog.io` no Cloudflare Registrar e ativar o DNSSEC.
- [ ] Criar as contas gratuitas: Cloudflare, Oracle Cloud, Neon, Upstash, Vercel, Resend e Better Stack (monitor externo).
- [ ] Ativar passkey ou chave de segurança em todas essas contas, além do GitHub e do npm.
- [x] Configurar a assinatura de commits com chave SSH no Git e no GitHub. *(feito em 30/10/2026, no meio do M0 — os commits anteriores a essa data não estão assinados; ver `docs/process/branching.md`.)*
- [ ] Ativar o Cloudflare Email Routing para `security@`, `dmarc@` e `contato@nekolog.io`.

---

## M0 — Fundação

- [x] **0.1** `chore/repo-init` — repositório `nekolog-io/nekolog` com as branches `main`, `qa` e `dev`; `.gitignore`, `.editorconfig`, `.nvmrc` (Node 24), licenças e README em inglês, com versões em pt-BR e es.
- [ ] **0.2** `chore/github-tracking` — script com o `gh` que cria os milestones M0–M6 e uma issue por etapa a partir deste arquivo, com labels por tipo (`feat`, `security`, `infra`…).
- [x] **0.3** `chore/workspace` — pnpm workspaces, Turborepo, `tsconfig` base e Biome; pnpm com `onlyBuiltDependencies` e `minimumReleaseAge`.
- [x] **0.4** `chore/commit-conventions` — commitlint (Conventional Commits), git hooks com lefthook, templates de PR e de issue.
- [x] **0.5** `ci/pipeline` — workflow de PR com lint, typecheck, testes e build; actions fixadas por SHA, `permissions` mínimas, harden-runner e cache do pnpm.
- [x] **0.6** `security/baseline` — `SECURITY.md`, Dependabot, Renovate (com `minimumReleaseAge`), CodeQL, dependency review, OpenSSF Scorecard e `CODEOWNERS`.
- [x] **0.7** `ci/branch-rules` — check que só aceita PRs para `qa` vindos da `dev`, e para `main` vindos da `qa`, de `hotfix/…` ou do PR do Changesets; fluxo documentado em `docs/process/branching.md`. Depois, configurar os rulesets no GitHub (manual).
- [x] **0.8** `chore/changesets` — Changesets versionando pacotes e apps, snapshots `dev` e `next`, workflow de release ainda sem publicar.
- [x] **0.9** `chore/internal-base` — `internal/config` (com a validação das variáveis de ambiente da especificação 2), `internal/schema` e as interfaces de `internal/adapters`.
- [x] **0.10** `infra/dev-compose` — `deploy/docker-compose.dev.yml` com ClickHouse, Postgres, Valkey, Mailpit e Garage; script `pnpm dev`; `.env.example`.
- [x] **0.11** `feat/web-scaffold` — `apps/web` com Next.js, Tailwind v4, shadcn/ui, tema Grafite (`tema/globals.css`), seletor de tema e `next-intl` com en, pt-BR e es.
- [x] **0.12** `feat/docs-scaffold` — `apps/docs` com Starlight nos três idiomas.
- [x] **0.13** `test/i18n-parity` — teste que falha se uma chave de tradução faltar em algum idioma.
- [x] **0.14** `docs/adr` — ADRs das decisões da seção 1 do plano.
- [x] **0.15** `docs/security` — primeira versão do modelo de ameaças e dos runbooks.

**Pronto quando:** `pnpm dev` sobe tudo, o CI passa nas três branches e o dashboard vazio abre com tema claro e escuro nos três idiomas.

## M1 — Ingestão

- [x] **1.1** `feat/schema-v1` — formato do payload v1 (tipos + Valibot), conforme a especificação 1.
- [x] **1.2** `feat/clickhouse-migrations` — runner de migrations (especificação 3), tabela `logs`, *materialized view* `logs_per_minute` e usuários só com `INSERT` e só com `SELECT`.
- [x] **1.3** `feat/core-logger` — `@nekolog-io/core`: níveis, `child()` e contexto.
- [x] **1.4** `feat/core-transport` — envio em lote, retry com backoff, respeito ao `429 Retry-After`, `flush()` e fila com limite.
- [x] **1.5** `feat/core-privacy` — remoção de dados sensíveis, amostragem e `beforeSend`.
- [x] **1.6** `feat/node-sdk` — `@nekolog-io/node`: `AsyncLocalStorage`, hooks do `process` e flush no `SIGTERM`.
- [x] **1.7** `feat/ingest-app` — `apps/ingest` com Hono: `POST /v1/logs`, validação, limites de tamanho e `/health`.
- [x] **1.8** `feat/ingest-keys` — `KeyStore` (KV e memória), hash das keys, origens permitidas, CORS e key na URL para o `sendBeacon`.
- [x] **1.9** `feat/ingest-storage` — `LogStore` para o ClickHouse, com `async_insert` e `waitUntil`.
- [ ] **1.10** `feat/jobs-worker` — `apps/jobs` com um cron por ambiente que dispara todas as tarefas agendadas.
- [ ] **1.11** `feat/ingest-spool` — contingência no R2, com token de deduplicação e reenvio pelos jobs.
- [ ] **1.12** `feat/ingest-limits` — rate limit em memória, limite de atributos por projeto e bloqueio por cota via KV.
- [ ] **1.13** `feat/seed-script` — script que cria org, projeto, ambientes e keys antes de existir o dashboard.
- [ ] **1.14** `test/ingest-integration` — testes de contrato SDK ↔ ingest, integração com ClickHouse, Postgres e Redis no CI e fuzzing do validador.
- [ ] **1.15** `feat/example-express` — `examples/express` mandando logs de verdade.
- [ ] **1.16** `infra/opentofu-base` — OpenTofu em `infra/` com estado criptografado no R2, um diretório por ambiente, `tofu plan` nos PRs e `apply` no merge; DNS, Tunnel, Access, KV, R2 e rulesets do GitHub.
- [ ] **1.17** `infra/oracle-vm` — VM criada pelo OpenTofu, com cloud-init + compose: ClickHouse com databases `nekolog_dev`, `nekolog_qa` e `nekolog_prod`, Tunnel, nenhuma porta aberta, SSH pelo Cloudflare Access e `unattended-upgrades`.
- [ ] **1.18** `ci/deploy-workers` — `wrangler deploy --env` de ingest e jobs para `dev`, `qa` e `prod`, com environments protegidos no GitHub.

**Pronto quando:** um `log.info()` no exemplo Express aparece no ClickHouse do ambiente `dev`.

## M2 — Plataforma

> **Nota (30/10/2026):** o dashboard virou um produto de código fechado, no repositório privado [`nekolog-dashboard`](https://github.com/gabrielbarbosaa/nekolog-dashboard) (ver PLANO.md seção 1 e 2). As etapas abaixo ainda descrevem o escopo certo, mas a numeração, os nomes de branch e os PRs de boa parte delas (tudo que é dashboard/auth/UI) vão acontecer naquele repositório, não aqui. `internal/db` e os adaptadores continuam neste repositório público, já que `apps/jobs` também depende deles. Antes de começar o M2, revisitar este marco e separar o que fica aqui do que migra para o repo novo.

**Base**

- [ ] **2.1** `docs/ui-mockups` — mockups HTML no tema Grafite das telas principais (login e código, Explorer, issues, keys, primeiro log) para aprovação, seguindo o mapa de telas da seção 10.1 do plano.
- [ ] **2.2** `feat/db-schema` — Drizzle: `users`, `organizations`, `memberships`, `invites`, `projects`, `environments`, `api_keys` e `audit_log`; uma branch do Neon por ambiente.
- [ ] **2.3** `feat/redis-adapter` — cliente Redis (Upstash e ioredis), carga dos scripts Lua por hash e prefixo por ambiente.
- [ ] **2.4** `feat/mailer` — adaptador `Mailer` (Resend, SMTP e Mailpit), templates React Email nos três idiomas e lista de destinatários autorizados em `dev` e `qa`.

**Autenticação**

- [ ] **2.5** `feat/auth-password` — argon2id, política de senha e Pwned Passwords.
- [ ] **2.6** `feat/auth-otp` — gerador de códigos e scripts Lua de emissão e verificação.
- [ ] **2.7** `feat/auth-signup` — cadastro por convite, confirmação de e-mail e Turnstile.
- [ ] **2.8** `feat/auth-login` — `login/start`, `login/verify` e `login/resend`, com proteção contra enumeração e rate limit (5 por conta e 20 por IP a cada 15 min).
- [ ] **2.9** `feat/auth-tokens` — JWT Ed25519 com `kid`, rotação do refresh token e sessões no Redis.
- [ ] **2.10** `feat/auth-proxy` — `proxy.ts` com renovação automática, checagem de `Origin` e helper de sessão.
- [ ] **2.11** `feat/auth-account` — recuperar e trocar senha, trocar e-mail, sessões ativas, sair de todos os dispositivos e re-autenticação.
- [ ] **2.12** `security/headers` — CSP com nonce, HSTS e demais cabeçalhos, com teste automático.
- [ ] **2.13** `test/auth-e2e` — todos os testes da seção 11.11 do plano, com Playwright e Mailpit.

**Produto**

- [ ] **2.14** `feat/orgs-members` — organizações, convites, papéis e a matriz de permissões da seção 10.2 (`internal/auth/permissions.ts`), com um teste por célula e testes de IDOR.
- [ ] **2.15** `feat/projects-envs` — projetos e ambientes, com as configurações de cada um.
- [ ] **2.16** `feat/api-keys-ui` — criar, mostrar uma vez, revogar e rotacionar keys; último uso; sincronização com o KV.
- [ ] **2.17** `feat/explorer` — tabela virtualizada, filtros, período, detalhe em JSON com renderização segura, filtros na URL e fuso do usuário.
- [ ] **2.18** `feat/volume-chart` — ECharts com tema gerado dos tokens do CSS e gráfico de volume por nível, com legenda, texturas e tabela acessíveis.
- [ ] **2.19** `feat/operator-area` — área do operador: convites da instância, uso por org, ajuste de cotas e suspensão.
- [ ] **2.20** `feat/demo` — organização demo, sessão somente leitura e gerador de logs falsos.
- [ ] **2.21** `feat/legal-privacy` — termos de uso e política de privacidade nos três idiomas, exclusão de conta e exportação dos dados.

**Operação**

- [ ] **2.22** `infra/deploy-envs` — Vercel com `dev.nekolog.io`, `qa.nekolog.io` e `app.nekolog.io`, configurada pelo OpenTofu; segredos separados por ambiente.
- [ ] **2.23** `infra/email-dns` — subdomínio de envio, SPF, DKIM e DMARC pelo OpenTofu, e webhooks de bounce.
- [ ] **2.24** `feat/monitoring` — `/health` em tudo, monitor externo, heartbeat dos jobs e alertas de disco e de contingência.
- [ ] **2.25** `infra/backups` — `pg_dump` diário criptografado no R2 e primeiro teste de restauração.

**Pronto quando:** alguém convidado cria conta, entra com código, gera uma key e vê seus logs em produção.

## M3 — Front e integrações

- [ ] **3.1** `feat/browser-sdk` — `@nekolog-io/browser`: erros globais, sessão, `setUser` e envio no `pagehide`.
- [ ] **3.2** `feat/browser-breadcrumbs` — cliques, navegação e fetch.
- [ ] **3.3** `feat/browser-offline` — fila offline no IndexedDB.
- [ ] **3.4** `feat/trace-propagation` — `traceparent` só nos domínios configurados, no browser e no Node.
- [ ] **3.5** `feat/react-sdk` — Provider, `ErrorBoundary` e `useLogger`.
- [ ] **3.6** `feat/next-sdk` — integração via `instrumentation.ts`, no servidor e no cliente.
- [ ] **3.7** `feat/server-middlewares` — Express, Fastify e Hono.
- [ ] **3.8** `feat/nestjs` — módulo e interceptor.
- [ ] **3.9** `feat/log-transports` — transports para pino e winston.
- [ ] **3.10** `feat/trace-view` — linha do tempo por `trace_id` no dashboard.
- [ ] **3.11** `feat/examples` — um exemplo para cada integração, usados no e2e.
- [ ] **3.12** `ci/compat-matrix` — testes em Node 22, 24 e 26, Bun e Deno, Chromium, Firefox e WebKit; `size-limit` no SDK de browser.
- [ ] **3.13** `feat/cli-init` — `npx @nekolog-io/cli init`: detecta o framework, instala o SDK e cria o `.env`.
- [ ] **3.14** `feat/onboarding` — passo a passo "envie seu primeiro log", esperando o log chegar em tempo real.
- [ ] **3.15** `docs/sdk-guides` — guia de cada framework nos três idiomas, incluindo o CORS do `traceparent`.

**Pronto quando:** um clique no front e a request no back aparecem na mesma linha do tempo.

## M4 — Investigação

- [ ] **4.1** `feat/search-language` — parser da busca (AST → SQL parametrizado) conforme a especificação 4, com fuzzing.
- [ ] **4.2** `feat/saved-views` — views salvas e compartilháveis.
- [ ] **4.3** `feat/live-tail` — tempo real por polling.
- [ ] **4.4** `feat/log-context` — logs antes e depois de um log escolhido.
- [ ] **4.5** `feat/fingerprint` — fingerprint dos erros na ingestão, conforme a especificação 5.
- [ ] **4.6** `feat/issues` — lista de issues com status, contagem e ocorrências.
- [ ] **4.7** `feat/releases` — registro de releases.
- [ ] **4.8** `feat/cli-sourcemaps` — upload de source maps pela CLI, com validação de tamanho, tipo e nome.
- [ ] **4.9** `feat/bundler-plugin` — plugin com `unplugin`.
- [ ] **4.10** `feat/sourcemap-resolve` — stack trace com o código original na tela da issue.
- [ ] **4.11** `feat/clock-skew` — aviso quando o horário do cliente diverge do servidor.
- [ ] **4.12** `feat/export-manual` — exportação em JSON, XML e CSV gerada pelo ClickHouse direto no R2; download autenticado; proteção contra injeção de fórmulas no CSV; regra de ciclo de vida de 7 dias.
- [ ] **4.13** `feat/export-scheduled` — exportação agendada (diária ou semanal) por projeto e ambiente, executada pelos jobs, com e-mail de aviso e link para o dashboard.
- [ ] **4.14** `feat/dashboards` — dashboards customizáveis com widgets.

**Pronto quando:** um erro minificado aparece com arquivo e linha originais.

## M5 — Alertas e governança

- [ ] **5.1** `feat/alert-rules` — regras de limiar, taxa de erro, nova issue, regressão e ausência (especificação 6), avaliadas pelos jobs em lotes.
- [ ] **5.2** `feat/alert-channels` — e-mail, Slack, Discord e webhook, com proteção contra SSRF, segredos criptografados e webhooks assinados com HMAC.
- [ ] **5.3** `feat/alert-history` — histórico e cooldown.
- [ ] **5.4** `feat/env-settings` — retenção, amostragem e nível mínimo por ambiente.
- [ ] **5.5** `feat/server-redaction` — regras de remoção de dados no servidor.
- [ ] **5.6** `feat/usage-quotas` — uso e cotas na interface.
- [ ] **5.7** `feat/audit-log-ui` — audit log navegável.
- [ ] **5.8** `security/alerts` — alertas de eventos de segurança para o operador.
- [ ] **5.9** `feat/public-api` — API de leitura com keys `sk_` e escopos, documentada em OpenAPI.
- [ ] **5.10** `security/key-rotation` — rotação das chaves do JWT e do HMAC sem derrubar sessões, seguindo o runbook.

**Pronto quando:** um pico de erros em `production` gera alerta no Discord em ~1 min.

## M6 — 1.0

- [ ] **6.1** `feat/otlp` — endpoint OTLP/HTTP.
- [ ] **6.2** `infra/self-host` — docker-compose de produção em um comando e guia de instalação.
- [ ] **6.3** `docs/complete` — documentação completa e versionada nos três idiomas.
- [ ] **6.4** `test/load` — teste de carga com k6 e ajustes de desempenho.
- [ ] **6.5** `security/review` — checklist ASVS nível 2, varredura completa do ZAP e revisão do modelo de ameaças e do `internal/auth`.
- [ ] **6.6** `a11y/audit` — auditoria WCAG 2.2 AA e correções.
- [ ] **6.7** `chore/release-1-0` — saída do `0.x`, changelogs, notas da release e SBOM.
- [ ] **6.8** `docs/launch` — README final, demo pública e post de lançamento (TabNews, dev.to, Show HN).

**Pronto quando:** alguém sobe tudo seguindo só a documentação.
