# NekoLog — etapas de implementação

> Complementa o [PLANO.md](PLANO.md): o plano diz **o quê** e **por quê**; este arquivo diz **em que ordem**, etapa por etapa. Os contratos técnicos estão em [ESPECIFICACOES.md](ESPECIFICACOES.md). Atualizado em 29/10/2026.

## Como usar

- **Uma etapa = uma issue = uma branch a partir da `dev` = um PR.** Cada etapa é uma issue no milestone do seu marco (M0 a M6), criada pelo `pnpm tracking`; o nome da branch está ao lado de cada etapa.
- **A issue fecha sozinha** quando o PR daquela branch entra na `dev`, pelo workflow `close-step-issue`, que acha a issue pelo nome da branch no título. **`Closes #N` não funciona neste repositório:** o GitHub só fecha issue vinculada quando o PR entra na branch padrão (`main`), e toda etapa entra na `dev`.
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
- [x] **0.2** `chore/github-tracking` — script com o `gh` que cria os milestones M0–M6 e uma issue por etapa a partir deste arquivo, com labels por tipo (`feat`, `security`, `infra`…).
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
- [x] **1.10** `feat/jobs-worker` — `apps/jobs` com um cron por ambiente que dispara todas as tarefas agendadas.
- [x] **1.11** `feat/ingest-spool` — contingência no R2, com token de deduplicação e reenvio pelos jobs.
- [x] **1.12** `feat/ingest-limits` — rate limit em memória, limite de atributos por projeto e bloqueio por cota via KV.
- [x] **1.13** `feat/seed-script` — script que cria org, projeto, ambientes e keys antes de existir o dashboard.
- [x] **1.14** `test/ingest-integration` — testes de contrato SDK ↔ ingest, integração com ClickHouse, Postgres e Redis no CI e fuzzing do validador. *(Postgres e Redis ficam para quando existir quem os leia: `internal/db` é a 2.2 e o adaptador de Redis é a 2.3.)*
- [x] **1.15** `feat/example-express` — `examples/express` mandando logs de verdade. *(Junto veio o `pnpm --filter @apps/ingest serve`: sem uma ingestão para onde apontar, o exemplo não manda log nenhum.)*
- [x] **1.16** `infra/opentofu-base` — OpenTofu em `infra/` com estado criptografado no R2, um diretório por ambiente, `tofu plan` nos PRs e `apply` no merge; DNS, Tunnel, Access, KV, R2 e rulesets do GitHub. *(Entrega o código e o pipeline; o `apply` fica desligado até a variável `INFRA_ENABLED` existir — ver `infra/README.md`.)*
- [x] **1.17** `infra/oracle-vm` — VM criada pelo OpenTofu, com cloud-init + compose: ClickHouse com databases `nekolog_dev`, `nekolog_qa` e `nekolog_prod`, Tunnel, nenhuma porta aberta, SSH pelo Cloudflare Access e `unattended-upgrades`. *(A chave de SSH vai no cloud-init e não há regra de entrada na 22; a aplicação Access para SSH entra na 1.18, com o deploy. Como na 1.16, o `apply` fica desligado.)*
- [x] **1.18** `ci/deploy-workers` — `wrangler deploy --env` de ingest e jobs para `dev`, `qa` e `prod`, com environments protegidos no GitHub. *(Junto vieram o `internal/deploy`, que separa a configuração versionada dos valores da conta, o domínio do Worker de ingestão no OpenTofu e a aplicação Access do SSH que a 1.17 deixou pendente. Como na 1.16 e na 1.17, o deploy fica desligado até `WORKERS_DEPLOY_ENABLED` existir.)*

**Pronto quando:** um `log.info()` no exemplo Express aparece no ClickHouse do ambiente `dev`.

## M2 — Plataforma

> **Nota (03/11/2026):** este marco foi separado entre os dois repositórios, que
> é o que a nota anterior pedia antes de começar. As etapas **com caixa** abaixo
> são as que têm branch e PR **aqui**; as de dashboard, autenticação e interface
> estão em "O que acontece no nekolog-dashboard", no fim do marco. Elas ficam
> listadas porque o roteiro público mostra o produto inteiro, mas sem caixa, para
> o `pnpm tracking` não abrir issue delas neste repositório.
>
> Os números e os nomes de branch **não foram trocados**. As issues 2.1 a 2.25 já
> existem aqui, e o `internal/tracking` nunca renomeia nem fecha nada: renumerar
> abriria um segundo conjunto e deixaria o primeiro órfão.
>
> Como os dois repositórios compartilham código está no ADR
> [0016](adr/0016-pacotes-compartilhados-no-npm.md): `schema`, `adapters`,
> `clickhouse` e `db` saem de `internal/` e viram pacotes `@nekolog-io/*`
> publicados no npm. É a etapa 2.0, e ela vem antes de todas.

**Base compartilhada**

- [x] **2.0** `chore/shared-packages` — mover `internal/adapters`, `internal/clickhouse` e `internal/config` para `packages/`, publicados como `@nekolog-io/*` com tsdown, `isolatedDeclarations`, `publint` e `@arethetypeswrong/cli`. *(Primeira etapa do marco, apesar do número: a 2.2 já nasce neste formato. Os números existentes não podem ser remexidos — ver a nota acima e o ADR [0016](adr/0016-pacotes-compartilhados-no-npm.md). O `config` entrou no lugar do `schema` porque o `clickhouse` depende dele em runtime; o `schema` fica em `internal/` até alguém de fora precisar dele, e publicá-lo exige anotar os schemas Valibot um a um.)*
- [x] **2.2** `feat/db-schema` — Drizzle: `users`, `organizations`, `memberships`, `invites`, `projects`, `environments`, `api_keys` e `audit_log`; uma branch do Neon por ambiente. Nasce como `@nekolog-io/db` publicado, porque o dashboard escreve no mesmo banco. *(É o único pacote publicado cujos tipos saem do fonte: um `pgTable` devolve um tipo que ninguém escreve à mão, e o `isolatedDeclarations` do TypeScript 7 exigiria isso. A branch do Neon por ambiente está documentada no `packages/db/README.md`; não há conta para automatizar.)*
- [x] **2.3** `feat/redis-adapter` — cliente Redis (Upstash e ioredis), carga dos scripts Lua por hash e prefixo por ambiente. O adaptador é daqui; os scripts de autenticação em si são do dashboard (2.6). *(Nenhuma dependência nova em runtime: o `upstashRedis` só precisa de `fetch` e o `nodeRedis` recebe o cliente injetado, como o `kvKeyStore` recebe o binding.)*
- [x] **2.4** `feat/mailer` — adaptador `Mailer` (Resend, SMTP e Mailpit) e lista de destinatários autorizados em `dev` e `qa`. Os templates React Email ficam com quem envia: os de alerta aqui (M5), os de autenticação no dashboard. *(A allowlist falha fechada: lista vazia manda para ninguém. E toda mensagem é conferida contra injeção de cabeçalho antes da chamada de rede.)*

**Site e operação**

- [x] **2.12** `security/headers` — CSP com nonce, HSTS e demais cabeçalhos no `apps/web` e no `apps/docs`, com teste automático. O dashboard repete para si, no repositório dele. *(A política vive no `internal/security-headers`, que os dois leem. No site estático não dá para ter nonce por requisição: lá o `script-src` é feito de hashes gerados do `dist/`, e o build falha se o `vercel.json` parar de cobrir o que ele produziu. O teste do `apps/web` sobe o servidor de produção e recusa qualquer `<script>` sem o nonce.)*
- [x] **2.21** `feat/legal-privacy` — termos de uso e política de privacidade nos três idiomas, no site. A exclusão de conta e a exportação dos dados são telas do dashboard. *(Em `/legal/terms` e `/legal/privacy`. Os textos são dados tipados, não marcação, então há teste que falha quando uma tradução perde uma cláusula, atrasa a data ou repete o inglês. **Falta revisão jurídica** e falta a identificação legal completa do controlador — nome civil completo e endereço — antes do lançamento público (6.8); o que está lá é um texto honesto escrito por quem programa, não por quem advoga.)*
- [x] **2.22** `infra/deploy-envs` — Vercel com `dev.nekolog.io`, `qa.nekolog.io` e `app.nekolog.io`, configurada pelo OpenTofu; segredos separados por ambiente. Os projetos dos **dois** repositórios são declarados aqui, porque toda a infraestrutura vive neste. *(A raiz `infra/vercel` não é por ambiente: na Vercel a unidade é o projeto, e um projeto já contém os três — produção na `main`, `qa` e `dev` como preview de branch. O módulo recusa segredo de preview sem branch, que seria a mesma senha em `dev` e em `qa`. Como nas 1.16–1.18, **nada é aplicado**: não há conta, e `plan`/`apply` seguem atrás do `INFRA_ENABLED`.)*
- [x] **2.23** `infra/email-dns` — subdomínio de envio, SPF, DKIM e DMARC pelo OpenTofu, e webhooks de bounce. *(DNS em `infra/email`, com DMARC começando em `p=none` por variável. Do webhook vem o que dá para verificar aqui: `verifyWebhook` confere a assinatura HMAC antes de qualquer leitura — sem isso, quem achasse a URL suprimiria o endereço de outra pessoa e cortaria o login dela — e `suppressedMailer` mais a tabela `email_suppressions` impedem insistir em quem já devolveu. A rota que recebe o webhook é do dashboard, que é quem tem HTTP e Postgres.)*
- [x] **2.24** `feat/monitoring` — `/health` em tudo, monitor externo, heartbeat dos jobs e alertas de disco e de contingência. *(O `apps/web` ganhou `/health`; os outros dois já tinham. O heartbeat avisa a URL quando passou e `…/fail` quando falhou, para o monitor distinguir cron morto de tarefa quebrada, e monitor fora do ar nunca derruba a execução. A tarefa `capacity-watch` vigia o spool e a `system.disks`, e **alerta quando não consegue medir**. O canal do alerta ainda é o log: e-mail e Discord são a 5.2. Não há conta no Better Stack, então o monitor externo em si continua por configurar.)*
- [x] **2.25** `infra/backups` — `pg_dump` diário criptografado no R2 e primeiro teste de restauração. *(`pg_dump | gzip | age` num cano só, sem arquivo legível no meio, com a assinatura do `age` conferida antes do upload. O `internal/backup` tem a parte que dá para errar em silêncio — nome do objeto, retenção e sequência de comandos — e **recusa apagar a lista inteira**: se tudo parece vencido, o errado é o relógio. O teste de restauração é um `workflow_dispatch` que restaura num Postgres descartável e consulta tabela por tabela. Atrás de `BACKUPS_ENABLED`, que não existe: não há banco no Neon nem bucket no R2.)*

### O que acontece no nekolog-dashboard

O escopo abaixo continua valendo; só a branch e o PR mudam de endereço. O
`internal/auth` (senhas, OTP, JWT, sessões) nasce lá e nunca existe aqui.

**Base**

- **2.1** `docs/ui-mockups` — mockups HTML no tema Grafite das telas principais (login e código, Explorer, issues, keys, primeiro log) para aprovação, seguindo o mapa de telas da seção 10.1 do plano.

**Autenticação**

- **2.5** `feat/auth-password` — argon2id, política de senha e Pwned Passwords.
- **2.6** `feat/auth-otp` — gerador de códigos e scripts Lua de emissão e verificação.
- **2.7** `feat/auth-signup` — cadastro por convite, confirmação de e-mail e Turnstile.
- **2.8** `feat/auth-login` — `login/start`, `login/verify` e `login/resend`, com proteção contra enumeração e rate limit (5 por conta e 20 por IP a cada 15 min).
- **2.9** `feat/auth-tokens` — JWT Ed25519 com `kid`, rotação do refresh token e sessões no Redis.
- **2.10** `feat/auth-proxy` — `proxy.ts` com renovação automática, checagem de `Origin` e helper de sessão.
- **2.11** `feat/auth-account` — recuperar e trocar senha, trocar e-mail, sessões ativas, sair de todos os dispositivos e re-autenticação.
- **2.13** `test/auth-e2e` — todos os testes da seção 11.11 do plano, com Playwright e Mailpit.

**Produto**

- **2.14** `feat/orgs-members` — organizações, convites, papéis e a matriz de permissões da seção 10.2 (`internal/auth/permissions.ts`), com um teste por célula e testes de IDOR.
- **2.15** `feat/projects-envs` — projetos e ambientes, com as configurações de cada um.
- **2.16** `feat/api-keys-ui` — criar, mostrar uma vez, revogar e rotacionar keys; último uso; sincronização com o KV.
- **2.17** `feat/explorer` — tabela virtualizada, filtros, período, detalhe em JSON com renderização segura, filtros na URL e fuso do usuário.
- **2.18** `feat/volume-chart` — ECharts com tema gerado dos tokens do CSS e gráfico de volume por nível, com legenda, texturas e tabela acessíveis.
- **2.19** `feat/operator-area` — área do operador: convites da instância, uso por org, ajuste de cotas e suspensão.
- **2.20** `feat/demo` — organização demo, sessão somente leitura e gerador de logs falsos.

**Pronto quando:** alguém convidado cria conta, entra com código, gera uma key e vê seus logs em produção. *(É o critério do produto, e ele atravessa os dois repositórios: a key e os logs são daqui, a conta e a tela são de lá.)*

## M3 — Front e integrações

> **Nota (03/11/2026):** como o M2, este marco está separado entre os dois
> repositórios. As etapas **com caixa** são as que têm branch e PR **aqui** —
> os SDKs, os exemplos, a CLI, a matriz de compatibilidade e os guias. As duas
> de interface estão em "O que acontece no nekolog-dashboard", no fim do marco.
> Os números e os nomes de branch **não mudaram**, pelo mesmo motivo do M2: as
> issues 3.1 a 3.15 já existem, e o `internal/tracking` nunca renomeia nada.
>
> **O M4, o M5 e o M6 ainda não foram separados**, e isso é deliberado. Lá a
> divisão quase nunca é por etapa inteira: a busca tem o parser aqui e a tela
> lá, o alerta é avaliado pelos jobs daqui e configurado lá, a exportação é
> gerada aqui e baixada lá. Decidir agora onde cada metade começa seria desenhar
> no escuro; cada marco é separado quando começa, como este e como o M2.

- [x] **3.1** `feat/browser-sdk` — `@nekolog-io/browser`: erros globais, sessão, `setUser` e envio no `pagehide`.
- [x] **3.2** `feat/browser-breadcrumbs` — cliques, navegação e fetch.
- [x] **3.3** `feat/browser-offline` — fila offline no IndexedDB.
- [ ] **3.4** `feat/trace-propagation` — `traceparent` só nos domínios configurados, no browser e no Node.
- [ ] **3.5** `feat/react-sdk` — Provider, `ErrorBoundary` e `useLogger`.
- [ ] **3.6** `feat/next-sdk` — integração via `instrumentation.ts`, no servidor e no cliente.
- [ ] **3.7** `feat/server-middlewares` — Express, Fastify e Hono.
- [ ] **3.8** `feat/nestjs` — módulo e interceptor.
- [ ] **3.9** `feat/log-transports` — transports para pino e winston.
- [ ] **3.11** `feat/examples` — um exemplo para cada integração, usados no e2e.
- [ ] **3.12** `ci/compat-matrix` — testes em Node 22, 24 e 26, Bun e Deno, Chromium, Firefox e WebKit; `size-limit` no SDK de browser.
- [ ] **3.13** `feat/cli-init` — `npx @nekolog-io/cli init`: detecta o framework, instala o SDK e cria o `.env`.
- [ ] **3.15** `docs/sdk-guides` — guia de cada framework nos três idiomas, incluindo o CORS do `traceparent`.

### O que acontece no nekolog-dashboard

O escopo continua valendo; só a branch e o PR mudam de endereço. As duas etapas
abaixo são tela, e dependem do que este marco entrega aqui: sem o `traceparent`
da 3.4 não há linha do tempo para desenhar, e sem a CLI da 3.13 não há comando
para o passo a passo mostrar.

- **3.10** `feat/trace-view` — linha do tempo por `trace_id`, com o clique no front e a request no back na mesma tela.
- **3.14** `feat/onboarding` — passo a passo "envie seu primeiro log" (a rota `…/setup` do mapa de telas da seção 10.1 do plano), esperando o log chegar em tempo real.

**Pronto quando:** um clique no front e a request no back aparecem na mesma linha do tempo. *(Como no M2, o critério atravessa os dois repositórios: a propagação do `traceparent` e os SDKs são daqui, a linha do tempo é de lá.)*

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
