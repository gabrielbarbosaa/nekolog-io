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
> são as que têm branch e PR; as de dashboard, autenticação e interface estão em
> "O dashboard", no fim do marco.
>
> Os números e os nomes de branch **não foram trocados**. As issues 2.1 a 2.25 já
> existem aqui, e o `internal/tracking` nunca renomeia nem fecha nada: renumerar
> abriria um segundo conjunto e deixaria o primeiro órfão.
>
> Como os dois repositórios compartilhavam código estava no ADR
> [0016](adr/0016-pacotes-compartilhados-no-npm.md): `adapters`, `clickhouse`,
> `config` e `db` saíram de `internal/` e viraram pacotes `@nekolog-io/*` para
> publicar no npm. É a etapa 2.0 — e a
> [0019](adr/0019-um-repositorio-so.md) a substituiu: eles voltam a ser privados
> e nenhum deles vai ao npm.

> **Nota (06/11/2026):** a divisão em dois repositórios acabou — ADR
> [0019](adr/0019-um-repositorio-so.md). O dashboard vem para cá como
> `apps/dashboard`, e as **25 etapas** de dashboard do M2 ao M6 ganharam caixa,
> em todos os marcos. Elas não ficaram sem caixa por serem menos importantes: era
> para o `pnpm tracking` não abrir issue de trabalho de outro repositório. A 2.1
> é a única marcada, porque os mockups já foram entregues.
>
> **Nenhuma issue nova é aberta por isso.** As 24 que restam já existem aqui
> desde antes da divisão — o `internal/tracking` nunca fecha nem renomeia nada,
> então elas ficaram abertas o tempo todo. O `pnpm tracking` confirma: `0 issues`
> a criar, e sete corpos a atualizar.

> **Nota (06/11/2026):** antes da 2.5 entrou a fundação do `apps/dashboard` —
> Next.js, tema Grafite, três idiomas, cabeçalhos com nonce e `/health`. Ela não
> tem número porque não é uma etapa do plano: é o que a 2.0 foi para os pacotes
> compartilhados. As regras de desenho que ela fixou estão no
> `apps/dashboard/README.md`.

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

### O dashboard, em `apps/dashboard`

O escopo abaixo continua valendo; só a branch e o PR mudam de endereço. O
`internal/auth` (senhas, OTP, JWT, sessões) nasce lá e nunca existe aqui.

**Base**

- [x] **2.1** `docs/ui-mockups` — mockups HTML no tema Grafite das telas principais (login e código, Explorer, issues, keys, primeiro log) para aprovação, seguindo o mapa de telas da seção 10.1 do plano.

**Autenticação**

- [ ] **2.5** `feat/auth-password` — argon2id, política de senha e Pwned Passwords.
- [ ] **2.6** `feat/auth-otp` — gerador de códigos e scripts Lua de emissão e verificação.
- [ ] **2.7** `feat/auth-signup` — cadastro por convite, confirmação de e-mail e Turnstile.
- [ ] **2.8** `feat/auth-login` — `login/start`, `login/verify` e `login/resend`, com proteção contra enumeração e rate limit (5 por conta e 20 por IP a cada 15 min).
- [ ] **2.9** `feat/auth-tokens` — JWT Ed25519 com `kid`, rotação do refresh token e sessões no Redis.
- [ ] **2.10** `feat/auth-proxy` — `proxy.ts` com renovação automática, checagem de `Origin` e helper de sessão.
- [ ] **2.11** `feat/auth-account` — recuperar e trocar senha, trocar e-mail, sessões ativas, sair de todos os dispositivos e re-autenticação.
- [ ] **2.13** `test/auth-e2e` — todos os testes da seção 11.11 do plano, com Playwright e Mailpit.

**Produto**

- [ ] **2.14** `feat/orgs-members` — organizações, convites, papéis e a matriz de permissões da seção 10.2 (`internal/auth/permissions.ts`), com um teste por célula e testes de IDOR.
- [ ] **2.15** `feat/projects-envs` — projetos e ambientes, com as configurações de cada um.
- [ ] **2.16** `feat/api-keys-ui` — criar, mostrar uma vez, revogar e rotacionar keys; último uso; sincronização com o KV.
- [ ] **2.17** `feat/explorer` — tabela virtualizada, filtros, período, detalhe em JSON com renderização segura, filtros na URL e fuso do usuário.
- [ ] **2.18** `feat/volume-chart` — ECharts com tema gerado dos tokens do CSS e gráfico de volume por nível, com legenda, texturas e tabela acessíveis.
- [ ] **2.19** `feat/operator-area` — área do operador: convites da instância, uso por org, ajuste de cotas e suspensão.
- [ ] **2.20** `feat/demo` — organização demo, sessão somente leitura e gerador de logs falsos.

**Pronto quando:** alguém convidado cria conta, entra com código, gera uma key e vê seus logs em produção. *(É o critério do produto, e ele atravessa servidor e dashboard: a key e os logs são do servidor, a conta e a tela são do dashboard.)*

## M3 — Front e integrações

> **Nota (03/11/2026):** como o M2, este marco está separado entre os dois
> repositórios. As etapas **com caixa** são as que têm branch e PR **aqui** —
> os SDKs, os exemplos, a CLI, a matriz de compatibilidade e os guias. As duas
> de interface estão em "O dashboard", no fim do marco.
> Os números e os nomes de branch **não mudaram**, pelo mesmo motivo do M2: as
> issues 3.1 a 3.15 já existem, e o `internal/tracking` nunca renomeia nada.
>
> **O M5 e o M6 ainda não foram separados**, e isso é deliberado. Lá a divisão
> quase nunca é por etapa inteira: o alerta é avaliado pelos jobs daqui e
> configurado lá. Decidir agora onde cada metade começa seria desenhar no
> escuro; cada marco é separado quando começa, como este, como o M2 e como o M4.

- [x] **3.1** `feat/browser-sdk` — `@nekolog-io/browser`: erros globais, sessão, `setUser` e envio no `pagehide`.
- [x] **3.2** `feat/browser-breadcrumbs` — cliques, navegação e fetch.
- [x] **3.3** `feat/browser-offline` — fila offline no IndexedDB.
- [x] **3.4** `feat/trace-propagation` — `traceparent` só nos domínios configurados, no browser e no Node.
- [x] **3.5** `feat/react-sdk` — Provider, `ErrorBoundary` e `useLogger`.
- [x] **3.6** `feat/next-sdk` — integração via `instrumentation.ts`, no servidor e no cliente.
- [x] **3.7** `feat/server-middlewares` — Express, Fastify e Hono.
- [x] **3.8** `feat/nestjs` — módulo e interceptor.
- [x] **3.9** `feat/log-transports` — transports para pino e winston.
- [x] **3.11** `feat/examples` — um exemplo para cada integração, usados no e2e.
- [x] **3.12** `ci/compat-matrix` — testes em Node 22, 24 e 26, Bun e Deno, Chromium, Firefox e WebKit; `size-limit` no SDK de browser.
- [x] **3.13** `feat/cli-init` — `npx @nekolog-io/cli init`: detecta o framework, instala o SDK e cria o `.env`.
- [x] **3.15** `docs/sdk-guides` — guia de cada framework nos três idiomas, incluindo o CORS do `traceparent`.

### O dashboard, em `apps/dashboard`

O escopo continua valendo; só a branch e o PR mudam de endereço. As duas etapas
abaixo são tela, e dependem do que este marco entrega aqui: sem o `traceparent`
da 3.4 não há linha do tempo para desenhar, e sem a CLI da 3.13 não há comando
para o passo a passo mostrar.

- [ ] **3.10** `feat/trace-view` — linha do tempo por `trace_id`, com o clique no front e a request no back na mesma tela.
- [ ] **3.14** `feat/onboarding` — passo a passo "envie seu primeiro log" (a rota `…/setup` do mapa de telas da seção 10.1 do plano), esperando o log chegar em tempo real.

**Pronto quando:** um clique no front e a request no back aparecem na mesma linha do tempo. *(Como no M2, o critério atravessa servidor e dashboard: a propagação do `traceparent` e os SDKs são do servidor, a linha do tempo é do dashboard.)*

## M4 — Investigação

> **Nota (03/11/2026):** este marco foi separado entre os dois repositórios, como
> o M2 e o M3, e por isso não dá para copiar o formato dos dois. Aqui a divisão
> quase nunca é por etapa inteira: a busca tem o parser **aqui** e a tela **lá**,
> a issue é montada pelos jobs daqui e listada lá, a exportação é gerada aqui e
> baixada lá. Então a maioria das etapas **mantém a caixa**, com a linha dizendo
> qual metade é do servidor; a outra metade está descrita em "O dashboard", no
> fim do marco.
>
> O critério é o de sempre (plano, seções 1, 2 e 5): SDK, ingestão, jobs,
> `packages/*` e API pública são daqui; tela, sessão e permissão são de lá. Três
> consequências que não são óbvias:
>
> - **Todo esquema de Postgres é daqui**, inclusive o das telas de lá, porque os
>   dois repositórios escrevem no mesmo banco e um esquema duplicado é a única
>   divergência que teste nenhum dos dois lados pega (ADR
>   [0016](adr/0016-pacotes-compartilhados-no-npm.md)). É o que a **4.15**
>   entrega — uma etapa nova, no fim da lista, pelo mesmo motivo que os números
>   nunca mudam.
> - **O source map é aplicado na hora de exibir, não na ingestão** (plano, seção
>   9), então a **4.10** é inteira de lá, embora o upload (4.8 e 4.9) seja daqui.
> - **A API pública de leitura é do M5**, não deste marco. Até lá o dashboard
>   consulta o ClickHouse com o `@nekolog-io/clickhouse` publicado, que é
>   exatamente por que o parser da 4.1 mora aqui.
>
> Os números e os nomes de branch **não mudaram**, pelo mesmo motivo do M2 e do
> M3: as issues 4.1 a 4.14 já existem e o `internal/tracking` nunca renomeia nem
> fecha nada. As três que perderam a caixa continuam abertas aqui, órfãs, e isso
> é o custo aceito — como as 3.10 e 3.14.

- [x] **4.1** `feat/search-language` — parser da busca (AST → SQL parametrizado) conforme a especificação 4, com fuzzing. *(Daqui: o parser e o gerador de SQL em `packages/clickhouse`. A barra de busca é de lá.)*
- [x] **4.4** `feat/log-context` — logs antes e depois de um log escolhido. *(Daqui: a consulta de janela no query builder. O "ver contexto" é de lá.)*
- [x] **4.5** `feat/fingerprint` — fingerprint dos erros na ingestão, conforme a especificação 5. *(Inteira daqui: é CPU pura sobre o evento, e o ClickHouse não preenche a coluna depois do insert sem mutation.)*
- [x] **4.6** `feat/issues` — issues montadas e mantidas pelos jobs: agrupamento por fingerprint, contagem, primeira e última ocorrência, status. *(A lista e a tela da issue são de lá. As tabelas `issues` e `issue_environments` vieram com esta etapa, não com a 4.15, porque o job que as escreve é quem define o formato delas.)*
- [x] **4.7** `feat/releases` — registro de release pela CLI e a escrita no banco. *(A tela `…/releases` é de lá. A escrita é uma rota nova no `apps/api`, que a 5.9 criou.)*
- [x] **4.8** `feat/cli-sourcemaps` — upload de source maps pela CLI, com validação de tamanho, tipo e nome. *(Inteira daqui, sobre o `apps/api` da 5.9. O armazenamento é um `BlobStore`: bucket R2 na nuvem, diretório no self-host — ao contrário das exportações, aqui é a aplicação que recebe os bytes.)*
- [x] **4.9** `feat/bundler-plugin` — plugin com `unplugin`. *(Inteira daqui. Sobe pelo que a 4.8 decidiu: chama a release e o upload da 4.7 e da 4.8 no `writeBundle`, com uma entrada por bundler.)*
- [x] **4.11** `feat/clock-skew` — a ingestão mede a diferença entre o `timestamp` do cliente e o `received_at` do servidor e marca o evento. *(O aviso na tela é de lá.)*
- [x] **4.12** `feat/export-manual` — exportação em JSON, XML e CSV gerada pelo ClickHouse direto no R2, com proteção contra injeção de fórmulas no CSV e regra de ciclo de vida de 7 dias. *(O download autenticado é de lá: ele depende de sessão e de permissão no ambiente.)*
- [x] **4.13** `feat/export-scheduled` — exportação agendada (diária ou semanal) por projeto e ambiente, executada pelos jobs, com o e-mail de aviso. *(A tela que agenda é de lá; o e-mail leva ao dashboard, não traz anexo.)*
- [x] **4.15** `feat/db-investigation` — as tabelas de Postgres que este marco pede: views salvas, releases, exportações e dashboards, com as *check constraints* no próprio esquema. *(Etapa nova. Ela vem antes da 4.2, da 4.7, da 4.12 e da 4.14. A tabela `issues` fica com a 4.6, junto do job que a escreve.)*

### O dashboard, em `apps/dashboard`

O escopo continua valendo; só a branch e o PR mudam de endereço.

- [ ] **4.2** `feat/saved-views` — views salvas e compartilháveis (tela; a tabela é a 4.15).
- [ ] **4.3** `feat/live-tail` — tempo real por polling a cada 2–3 s, sobre a mesma busca da 4.1.
- [ ] **4.10** `feat/sourcemap-resolve` — stack trace com o código original na tela da issue. É aqui que o source map enviado pela 4.8 é aplicado, na hora de exibir.
- [ ] **4.14** `feat/dashboards` — dashboards customizáveis com widgets (tela; a tabela é a 4.15).

**Pronto quando:** um erro minificado aparece com arquivo e linha originais. *(Como no M2 e no M3, o critério atravessa servidor e dashboard: o upload do source map e o fingerprint são do servidor, a resolução na tela é do dashboard.)*

## M5 — Alertas e governança

> **Nota (04/11/2026):** este marco foi separado entre os dois repositórios, como
> o M2, o M3 e o M4. O critério é o de sempre (plano, seções 1, 2 e 5): SDK,
> ingestão, jobs, `packages/*` e API pública são daqui; tela, sessão e permissão
> são de lá. Como no M4, a maioria das etapas **mantém a caixa**, com a linha
> dizendo qual metade é daqui.
>
> Quatro consequências que não são óbvias:
>
> - **O alerta é avaliado aqui e configurado lá.** A regra é uma linha no
>   Postgres que a tela de lá escreve; quem a lê, avalia e dispara é o
>   `apps/jobs`. Então a 5.1, a 5.2 e a 5.3 mantêm a caixa aqui pela metade que
>   roda, não pela metade que se configura.
> - **Não há uma etapa nova de tabelas, e isso é deliberado.** O M4 precisou da
>   4.15 porque as tabelas de lá não tinham, aqui, nenhuma etapa que as
>   escrevesse. Aqui as três tabelas do marco têm: a `alert_rules` vem com a
>   5.1, a `alert_channels` com a 5.2 e a `alert_events` com a 5.3, cada uma
>   junto do código que a escreve — que foi a lição da 4.6: tabela cujo escritor
>   ainda não existe é tabela desenhada no escuro. Por isso a 5.1 guarda o
>   estado (`ok`/`firing`) em colunas da própria regra, e só a 5.3 abre o
>   histórico.
> - **A 5.9 é a API pública de leitura, e é inteira daqui.** É também onde cabe
>   decidir onde mora uma escrita de servidor, que é o que trava a 4.7 e a 4.8:
>   se a resposta for "um app novo", ele nasce aqui, e a 4.7, a 4.8 e a 4.9 vêm
>   depois dela em vez de antes. **Decidido em 2026-11-04: é um app novo.**
>   `apps/api` nasceu na 5.9 só de leitura, em Worker e em Node, e a 4.7, a 4.8
>   e a 4.9 acrescentam rotas de escrita a ele.
> - **A rotação da 5.10 são duas chaves com donos diferentes.** O JWT é da
>   sessão, que é de lá; o HMAC assina os webhooks da 5.2, que são daqui. A
>   etapa mantém a caixa pela metade do HMAC.
>
> Os números e os nomes de branch **não mudaram**, pelo mesmo motivo do M2, do
> M3 e do M4: as issues 5.1 a 5.10 já existem e o `internal/tracking` nunca
> renomeia nem fecha nada. As duas que perderam a caixa continuam abertas aqui,
> órfãs, e isso é o custo aceito — como as 3.10, 3.14, 4.2, 4.3, 4.10 e 4.14.

- [x] **5.1** `feat/alert-rules` — regras de limiar, taxa de erro, nova issue, regressão e ausência (especificação 6), avaliadas pelos jobs em lotes. *(Daqui: a tabela `alert_rules`, a leitura da condição e o avaliador no `apps/jobs`. A tela que cria a regra é de lá; a `alert_events` fica com a 5.3.)*
- [x] **5.2** `feat/alert-channels` — e-mail, Slack, Discord e webhook, com proteção contra SSRF, segredos criptografados e webhooks assinados com HMAC. *(Daqui: a tabela `alert_channels`, o envio pelos jobs, a proteção contra SSRF e a assinatura HMAC. A tela que configura o canal é de lá.)*
- [x] **5.3** `feat/alert-history` — histórico e cooldown. *(Daqui: a tabela `alert_events`, gravada junto da transição, e o cooldown, que é o job decidindo não avisar de novo. A tela do histórico é de lá.)*
- [x] **5.4** `feat/env-settings` — retenção, amostragem e nível mínimo por ambiente. *(Daqui: as colunas em `environments` e o cumprimento na ingestão — amostrar e cortar por nível é no servidor, não na tela. A tela de configuração é de lá.)*
- [x] **5.5** `feat/server-redaction` — regras de remoção de dados no servidor. *(Daqui: a aplicação das regras no `apps/ingest`, antes da gravação. A tela que escreve as regras é de lá.)*
- [x] **5.8** `security/alerts` — alertas de eventos de segurança para o operador. *(Daqui: os eventos que esta base levanta — abuso de key, cota, capacidade — pelos canais da 5.2. Os eventos de sessão e de login são de lá.)*
- [x] **5.9** `feat/public-api` — API de leitura com keys `sk_` e escopos, documentada em OpenAPI. *(Inteira daqui.)*
- [x] **5.10** `security/key-rotation` — rotação das chaves do JWT e do HMAC sem derrubar sessões, seguindo o runbook. *(Daqui: a rotação do HMAC que assina os webhooks da 5.2. A do JWT e das sessões é de lá.)*

### O dashboard, em `apps/dashboard`

O escopo continua valendo; só a branch e o PR mudam de endereço.

- [ ] **5.6** `feat/usage-quotas` — uso e cotas na interface (tela; o cálculo e o bloqueio já existem desde a 1.12).
- [ ] **5.7** `feat/audit-log-ui` — audit log navegável (tela; a tabela `audit_log` existe desde a 2.2).

**Pronto quando:** um pico de erros em `production` gera alerta no Discord em ~1 min. *(Como no M2, no M3 e no M4, o critério atravessa servidor e dashboard: a regra é criada na tela e avaliada pelos jobs.)*

## M6 — 1.0

> **Nota (04/11/2026):** último marco, separado entre os dois repositórios como o
> M2, o M3, o M4 e o M5. Aqui a divisão é mais limpa que nos marcos anteriores:
> metade das etapas é **inteira daqui**, porque o self-host, o teste de carga e
> o endpoint OTLP só existem neste repositório.
>
> Três consequências que não são óbvias:
>
> - **O self-host (6.2) não leva o dashboard**, e isso não é uma lacuna: o
>   dashboard é fechado e só roda na instância hospedada (plano, seção 5). Quem
>   sobe por conta própria manda logs, consulta pela API pública da 5.9 e recebe
>   alertas. O guia tem que dizer isso na primeira página, não no rodapé.
> - **A revisão de segurança (6.5) é dos dois**, mas por motivos diferentes: o
>   ASVS e a revisão do `internal/auth` são de lá, porque autenticação mora lá;
>   o modelo de ameaças, a varredura do ZAP sobre a ingestão e a API, e os
>   itens S, I, T e E que esta base fecha são daqui. A etapa mantém a caixa pela
>   metade daqui.
> - **A auditoria de acessibilidade (6.6) perde a caixa**, embora `apps/web` e
>   `apps/docs` sejam daqui. A varredura WCAG séria é sobre a interface, e a
>   interface é de lá; o que roda aqui são os testes de `axe` que a 3.12 já
>   deixou ligados no site e na documentação, e eles continuam no CI sem
>   precisar de uma etapa própria.
>
> **A 6.1, a 6.2 e a 6.4 não dependem da decisão que trava a 4.7, a 4.8, a 4.9
> e a 5.9.** O endpoint OTLP é ingestão pura, o self-host sobe o que já existe e
> o teste de carga mede a ingestão. A 6.3 e a 6.7 esperam a 5.9, porque
> documentar e versionar uma API que ainda não existe é retrabalho garantido.
> **A 5.9 saiu em 2026-11-04 e destravou as três**: `apps/api` existe, serve o
> próprio OpenAPI e sobe tanto em Worker quanto no self-host, então a 6.3 tem o
> que documentar, a 6.4 tem o que medir e a 4.7, a 4.8 e a 4.9 têm onde escrever.
>
> Os números e os nomes de branch **não mudaram**, pelo mesmo motivo dos marcos
> anteriores. A que perdeu a caixa continua aberta aqui, órfã, como as outras
> seis.

- [x] **6.1** `feat/otlp` — endpoint OTLP/HTTP. *(Inteira daqui: é uma rota no `apps/ingest`.)*
- [x] **6.2** `infra/self-host` — docker-compose de produção em um comando e guia de instalação. *(Inteira daqui. O dashboard não entra, por ser fechado.)*
- [x] **6.3** `docs/complete` — documentação completa e versionada nos três idiomas. *(Daqui: a documentação do `apps/docs`, incluindo a referência da API pública da 5.9. O que é só da tela é de lá. Seis páginas novas por idioma — referência da API, linguagem de busca, OTLP, alertas, o que fica guardado e versionamento — e um teste que prende os números delas às constantes que os impõem.)*
- [x] **6.4** `test/load` — teste de carga com k6 e ajustes de desempenho. *(Inteira daqui: mede a ingestão, os jobs e a API pública. O k6 mede latência e vazão; o orçamento de 10 ms de CPU do Worker, que ele não enxerga, virou teste em `apps/ingest`. Os ajustes estão no plano, seção 19.1.)*
- [x] **6.5** `security/review` — checklist ASVS nível 2, varredura completa do ZAP e revisão do modelo de ameaças e do `internal/auth`. *(Daqui: o modelo de ameaças, o ZAP sobre a ingestão e a API, e os itens que esta base fecha. O ASVS e o `internal/auth` são de lá. O modelo foi para a versão 2, com as fronteiras 7 e 8 que não existiam; o ZAP achou dois headers faltando e a revisão achou que a API ignorava parâmetro desconhecido.)*
- [x] **6.7** `chore/release-1-0` — saída do `0.x`, changelogs, notas da release e SBOM. *(Daqui: os pacotes publicados no npm e o SBOM deste repositório. Os 17 pacotes e os 5 apps foram para a 1.0.0, com changelog por pacote gerado dos 68 changesets acumulados; a publicação passou a ser por trusted publishing, sem token nenhum; cada pacote sai com um SBOM CycloneDX anexado à Release dele, e `core`, `cli` e `adapters` têm a promessa de zero dependências conferida pelo lockfile. `changeset version` nunca tinha rodado neste repositório e falhava no primeiro comando.)*
- [x] **6.8** `docs/launch` — README final, demo pública e post de lançamento (TabNews, dev.to, Show HN). *(Daqui: o README, o site e o post. A demo pública é de lá, por ser uma sessão no dashboard. O README saiu nos três idiomas, com `CONTRIBUTING` e `CODE_OF_CONDUCT` que faltavam; a landing page deixou de ser prova de fiação e virou página de verdade, com os números presos às constantes que os impõem; o post está em `docs/launch/` em inglês e em português. Sem GIF: ele mostraria o dashboard, que é fechado.)*

### O dashboard, em `apps/dashboard`

O escopo continua valendo; só a branch e o PR mudam de endereço.

- [ ] **6.6** `a11y/audit` — auditoria WCAG 2.2 AA e correções (a interface é de lá; o `axe` do site e da documentação já roda aqui desde a 3.12).

**Pronto quando:** alguém sobe tudo seguindo só a documentação. *(Como nos marcos anteriores, o critério atravessa servidor e dashboard — mas aqui pende para o servidor: o self-host é todo dele.)*
