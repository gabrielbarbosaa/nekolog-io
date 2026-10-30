# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

M0 ("Fundação") is in progress — check `docs/ETAPAS.md` for exactly which steps are checked off before assuming something exists. As of this writing: pnpm workspace + Turborepo + Biome, commitlint/lefthook, CI (lint/typecheck/test/build), security baseline (CodeQL, dependency-review, Scorecard, Dependabot, Renovate), branch rulesets, Changesets, the `internal/config` + `internal/schema` + `internal/adapters` packages, the dev `docker-compose` stack, and a scaffolded `apps/web` — **the public landing page**, not the dashboard (see "Two repositories" below) — (Next.js 16 + Tailwind v4 + shadcn/ui + next-themes + next-intl, no real marketing content yet — just the Grafite theme, a theme toggle, and a locale switcher proving the wiring) all exist. Nothing else under `apps/` or `packages/` exists yet (no SDKs, no ingest/jobs Workers, no docs site) — that continues through step 0.12 and M1–M3.

**Two repositories (decided 2026-10-30):** this repo (`nekolog-io`, public, MIT) holds the SDKs, ingestion, jobs, public read API, landing page, and docs. The **dashboard is closed-source** and lives in a separate private repo, [`gabrielbarbosaa/nekolog-dashboard`](https://github.com/gabrielbarbosaa/nekolog-dashboard) — open-core model, so third parties can't see the dashboard's code. Self-host covers only what's in this public repo; the dashboard is cloud-only. See `docs/PLANO.md` §1, §2, §5, §10, §18, §20 for the full rationale and what's still undecided (e.g. how the dashboard repo will share `internal/db`/`internal/schema`/`internal/adapters` with this one). `docs/ETAPAS.md`'s M2 still describes the dashboard's scope but its steps will be re-run in the new repo, not here.

**Local toolchain note:** this project requires Node 24 (`.nvmrc`); some dependencies (e.g. `@changesets/cli`) use Node APIs unavailable on Node 20. If `node --version` doesn't match, switch with your Node version manager (e.g. `nvm install 24 && nvm use 24`) and re-run `corepack enable` before `pnpm install`.

The three documents in `docs/` are the source of truth for everything about this project:

- **[docs/PLANO.md](docs/PLANO.md)** — the "what" and "why": architecture, data model, APIs, auth design, theming, i18n, security, operations. Read this first for any architectural question.
- **[docs/ETAPAS.md](docs/ETAPAS.md)** — the "in what order": one checklist item = one GitHub issue = one branch = one PR, grouped into milestones M0–M6. Defines branch-naming prefixes and the definition of done for a step.
- **[docs/ESPECIFICACOES.md](docs/ESPECIFICACOES.md)** — binding technical contracts (ingestion payload v1, env vars, ClickHouse migration runner, search grammar, error fingerprinting, alert rules). These are the specs code must conform to once written; in the repo they're meant to eventually move to `docs/specs/` as individual files, one per spec, changed only by PR.
- **[docs/adr/](docs/adr/README.md)** — *why* each architectural decision was made, which alternatives were rejected, and what downside was accepted. Read the relevant ADR before proposing a change to something it covers; several decisions that look arbitrary (Valibot over Zod, OpenTofu over Terraform, in-house auth) have a concrete constraint behind them. ADRs are historical records — they are **not** edited when a decision changes; a new ADR supersedes the old one.
- **docs/tema/globals.css** — the canonical source for the Tailwind v4 / shadcn "Grafite" theme (OKLCH tokens, light+dark, log-level and environment colors, chart palette). Already copied verbatim into `apps/web/app/globals.css`; change tokens there first, then re-sync, don't fork the two files.

When asked to start implementing, consult ETAPAS.md for the next unchecked step and PLANO.md/ESPECIFICACOES.md for the contract that step must satisfy.

## What NekoLog is

An open-core logging platform for JS/TS apps (frontend + backend): npm SDKs that batch-send logs, an ingestion API, ClickHouse for storage, background jobs for alerts, and a dashboard with search/filters/charts/alerts, with separate API keys per environment (`nekolog_pk_…` public, `nekolog_sk_…` secret — the key determines the environment, SDKs never pass one explicitly).

It's a personal/portfolio project designed to run entirely on free-tier cloud services (Cloudflare Workers/KV/R2/Tunnel, Oracle Always Free VM for ClickHouse, Neon Postgres, Upstash Redis, Vercel, Resend). The SDKs, ingestion, jobs, and public read API are self-hostable via a single `docker-compose`; **the dashboard is not** — it's closed-source and cloud-only (see "Two repositories" above). The only paid cost is the `nekolog.io` domain.

### Architecture at a glance

```
SDKs (browser / node) → HTTPS batch (gzip)
   → Cloudflare Worker "ingest" (Hono) → KV (key→project/env/quota) → ClickHouse (via Tunnel, on Oracle VM)
   Cloudflare Worker "jobs" (cron, 1 min) → alerts/issues/usage/quotas → Resend/Slack/Discord/webhook
   Vercel: Next.js dashboard (closed-source, deployed from the separate nekolog-dashboard repo)
      → Neon Postgres (users/orgs/projects/keys/alerts), Upstash Redis (auth), Resend
   Cloudflare R2: source maps
```

Key invariants from `docs/PLANO.md` §3–4 that should guide any implementation:

- **Ingestion stays dumb; processing happens elsewhere.** The ingest API only validates and writes. Fingerprinting, source-map resolution, and alerting run in `apps/jobs`, not `apps/ingest`.
- **Ingestion never depends on Postgres or Redis** — keys live in Workers KV so Neon's cold-start/hibernation never adds latency to the hot path.
- **Vendor-specific behavior is always behind an interface** (`KeyStore`, `RateLimiter`, `BlobStore`, `Mailer`, `LogStore`, `RedisClient` in `internal/adapters/`) so the same code runs on free-tier cloud and in self-host (Redis/Valkey, MinIO, SMTP, local ClickHouse/Postgres).
- **The SDK must never throw into the host app** and ships with zero dependencies.
- Uses OpenTelemetry-style log shape and W3C `traceparent` propagation.
- **Privacy-by-default (LGPD):** sensitive fields are stripped client- and server-side; raw IPs are never stored, only resolved country.

### Planned repository layout (docs/PLANO.md §18)

This is the **public** repo's layout. The dashboard has its own structure in the separate **private** `nekolog-dashboard` repo (Next.js, `internal/auth`, `internal/db`'s consumer side — not here).

```
packages/       # published to npm: core, browser, node, react, next, express,
                # fastify, hono, nestjs, pino, winston, cli, bundler-plugin
apps/
  ingest/       # Hono → Cloudflare Workers and Node
  jobs/         # alerts, issues, usage, quotas
  web/          # public landing page (marketing site), theme, i18n — NOT the dashboard
  docs/         # Starlight docs site: en at /docs/, pt-BR at /docs/pt-br/, es at /docs/es/
internal/       # not published
  schema/       # ingestion payload format (SDK ↔ ingest contract)
  db/           # Drizzle + Postgres migrations — stays here because apps/jobs reads/writes it too
  clickhouse/   # migrations, query builder, search-language parser
  adapters/     # KeyStore, RateLimiter, BlobStore, Mailer, RedisClient
examples/       # express, nestjs, next, react-vite (also used by e2e tests)
deploy/         # docker-compose (dev + self-host), VM cloud-init, wrangler config
infra/          # OpenTofu: shared modules + one directory per environment
docs/adr/       # architecture decision records
docs/security/  # threat model and checklists
docs/runbooks/  # incident response, secret rotation, backup restore
docs/process/   # branching/release process
docs/specs/     # technical specs (payload, search, fingerprinting, alerts…)
```

## Commands that work today

- `pnpm install` — install everything (pnpm 12 via Corepack; `minimumReleaseAge` in `pnpm-workspace.yaml` will refuse packages published too recently — this is intentional, not a bug).
- `pnpm dev` — starts the dev `docker-compose` stack (ClickHouse on :8123, Postgres on :5432, Valkey on :6379, Mailpit on :8025 web UI, MinIO on :9000/:9001) and then `turbo run dev`, which also starts `apps/web` on :3000 (Turbopack) and `apps/docs` on :4321/docs (Astro). Copy `.env.example` to `.env` first. `pnpm dev:infra:down` / `pnpm dev:infra:logs` manage the docker stack directly.
- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` — Turborepo tasks fanning out to every package's own script (currently `apps/web`, `apps/docs`, `internal/config`, `internal/schema`, `internal/adapters` define some). A package with no matching script is silently skipped by Turbo — that's expected, not a failure. `apps/docs` deliberately has **no** `typecheck` script: `astro check` doesn't support TypeScript 7 and Astro is deprecating it — `astro build` validates the content schemas instead (see `apps/docs/README.md`).
- `apps/web` (landing page) locale: resolved from a `NEKOLOG_LOCALE` cookie, falling back to `Accept-Language`, falling back to `en` (see `apps/web/i18n/request.ts`) — no `/[locale]/` URL prefix. This mirrors the approach the dashboard repo should use too, since `docs/PLANO.md` §10.1's route map never puts locale in the path. The in-page `LocaleSwitcher`/`ThemeToggle` components are temporary proof-of-wiring from step 0.11, not final landing-page UI.
- `pnpm check` — `biome check --write .` (formats + lints; excludes `**/*.md` and lockfiles — see `biome.json`). CI instead runs `biome ci .` (no writes).
- `pnpm changeset` — add a changeset for a package/app you just changed; `pnpm changeset:status` shows what's pending relative to `dev`.
- To run a single package's tests/typecheck directly: `cd internal/config && pnpm test` or `pnpm --filter @internal/config test`.

## Planned tooling (not yet present in the repo)

- **Tests:** Playwright (e2e, including Mailpit-based auth flows and axe accessibility checks) — not wired up yet. Integration tests should run against real ClickHouse/Postgres/Redis as CI services — do not mock the database/ClickHouse for integration-level tests per the project's testing philosophy.
- **Build:** `tsdown` for package builds; `publint` + `@arethetypeswrong/cli` + `size-limit` (browser SDK must stay under 5 KB gzip) checked in CI.
- **ClickHouse migrations:** a custom TypeScript runner (one SQL statement per file in `internal/clickhouse/migrations/`, tracked in a `_migrations` table, forward-only, checksummed — see spec 3 in ESPECIFICACOES.md). Planned commands: `pnpm ch:migrate`, `pnpm ch:status`, `pnpm ch:new <name>`.
- **npm publishing:** Changesets' `release.yml` only maintains the "Version Packages" PR for now; trusted publishing (OIDC) gets wired up once real packages exist to publish.
- **Infra:** OpenTofu under `infra/envs/{dev,qa,prod}`, `tofu plan` on PRs touching `infra/`, `tofu apply` on merge.
- **Deploy:** `wrangler deploy --env <env>` for `apps/ingest` and `apps/jobs`; Vercel Git integration for `apps/web` and `apps/docs`.

## Conventions

- **No comments.** This codebase is deliberately comment-free — the maintainer's explicit call, applied across the whole repo on 2026-10-30. Do not add explanatory comments, JSDoc, section banners, or `TODO`/`NOTE` markers to any `.ts`, `.tsx`, `.mjs`, `.js`, `.css`, `.yml`, or `.yaml` file. Put the explanation in a name, a smaller function, the commit message, the PR body, or a doc under `docs/` — not in the source. Two things are **not** comments and stay: compiler/tool directives (`// @ts-check`, `biome-ignore`, `eslint-disable`) and reference data (the `/* #hex */` annotations next to each OKLCH token in `globals.css`, which are the only record of the original palette values). Markdown prose is unaffected.
- **Commits:** Conventional Commits in English, scoped by package/app (e.g. `feat(core): add batching transport`, `fix(ingest): reject payloads above 512 KB`), enforced by commitlint (`npm-conventional` types only — `security/`-prefixed branches still commit as `chore(security): ...` or similar, not `security(...)`, since `security` isn't a valid commit type).
- **Branches:** one step from ETAPAS.md = one branch off `dev`, prefixed `feat/`, `fix/`, `chore/`, `docs/`, `ci/`, `test/`, `security/`, `infra/`, or `a11y/`. PRs into `dev` squash-merge; promotion `dev→qa→main` uses merge commits (no squash) so branches don't diverge. **This is enforced live, not just convention:** GitHub rulesets on `main`/`qa`/`dev` block deletion/force-push and require PRs + passing status checks (nobody has bypass, not even the repo owner), and `.github/workflows/branch-rules.yml` rejects PRs into `qa`/`main` from the wrong source branch. The `gh` CLI is set up and authenticated in this environment — prefer it (`gh pr create`, `gh pr checks --watch`, `gh pr merge --squash --delete-branch`) over raw GitHub API calls.
- **A step merges only when:** CI is green, new tests cover the change, a changeset exists if a package/app changed, UI strings exist in all three locales, docs are updated for anything public-facing, and (if labeled `security`) the security checklist was followed.
- **i18n:** landing page, docs, dashboard (in its own repo), emails, and README ship in pt-BR, en (source/fallback), and es. Code, commits, branches, and PRs are English-only. **This is enforced by tests, not just convention:** `apps/web/i18n/messages.test.ts` fails if a message key is missing, stale, or blank in any locale, and `apps/docs/tests/i18n-parity.test.ts` fails if a docs page lacks a translation (or a translation has no English source). Each app's locale list is a single exported constant (`apps/web/i18n/locales.ts`, `apps/docs/locales.mjs`) that both the app config and its test read, so adding a locale immediately makes the test demand translations.
- **Security is the top priority** (docs/PLANO.md §14): parameterized SQL only, permission checks server-side on every route/query, SSRF protections on alert webhooks, CSV export must guard against formula injection, PRs touching `apps/ingest`, `internal/db`, or permission-checking code get the `security` label and a dedicated review pass. **[docs/security/threat-model.md](docs/security/threat-model.md) is the working list** — it maps each threat to its mitigation and marks what's implemented vs. still planned, so when you build a feature, check which threats it's supposed to close. It also records what was accepted *without* full mitigation, so don't "fix" those without reading why. Operational procedures live in [docs/runbooks/](docs/runbooks/README.md) (none exercised yet — the infra doesn't exist).
- **Logs are untrusted input** — anyone with a public key can send arbitrary text. Never render log content with `dangerouslySetInnerHTML`; escape everything.
