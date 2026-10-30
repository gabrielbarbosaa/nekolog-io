# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

M0 ("Fundação") is in progress — check `docs/ETAPAS.md` for exactly which steps are checked off before assuming something exists. As of this writing: pnpm workspace + Turborepo + Biome, commitlint/lefthook, CI (lint/typecheck/test/build), security baseline (CodeQL, dependency-review, Scorecard, Dependabot, Renovate), branch rulesets, Changesets, the `internal/config` + `internal/schema` + `internal/adapters` packages, and the dev `docker-compose` stack all exist. Nothing under `apps/` or `packages/` exists yet (no dashboard, no SDKs, no ingest/jobs Workers) — that starts at step 0.11 and continues through M1–M3.

**Local toolchain note:** this project requires Node 24 (`.nvmrc`); some dependencies (e.g. `@changesets/cli`) use Node APIs unavailable on Node 20. If `node --version` doesn't match, switch with your Node version manager (e.g. `nvm install 24 && nvm use 24`) and re-run `corepack enable` before `pnpm install`.

The three documents in `docs/` are the source of truth for everything about this project:

- **[docs/PLANO.md](docs/PLANO.md)** — the "what" and "why": architecture, data model, APIs, auth design, theming, i18n, security, operations. Read this first for any architectural question.
- **[docs/ETAPAS.md](docs/ETAPAS.md)** — the "in what order": one checklist item = one GitHub issue = one branch = one PR, grouped into milestones M0–M6. Defines branch-naming prefixes and the definition of done for a step.
- **[docs/ESPECIFICACOES.md](docs/ESPECIFICACOES.md)** — binding technical contracts (ingestion payload v1, env vars, ClickHouse migration runner, search grammar, error fingerprinting, alert rules). These are the specs code must conform to once written; in the repo they're meant to eventually move to `docs/specs/` as individual files, one per spec, changed only by PR.
- **docs/tema/globals.css** — the finished Tailwind v4 / shadcn "Grafite" theme (OKLCH tokens, light+dark, log-level and environment colors, chart palette). Destined for `apps/web/app/globals.css` once the dashboard scaffold exists — copy it, don't redesign it.

When asked to start implementing, consult ETAPAS.md for the next unchecked step and PLANO.md/ESPECIFICACOES.md for the contract that step must satisfy.

## What NekoLog is

An open-source logging platform for JS/TS apps (frontend + backend): npm SDKs that batch-send logs, an ingestion API, ClickHouse for storage, and a Next.js dashboard with search/filters/charts/alerts, with separate API keys per environment (`nekolog_pk_…` public, `nekolog_sk_…` secret — the key determines the environment, SDKs never pass one explicitly).

It's a personal/portfolio project designed to run entirely on free-tier cloud services (Cloudflare Workers/KV/R2/Tunnel, Oracle Always Free VM for ClickHouse, Neon Postgres, Upstash Redis, Vercel, Resend) and to also be self-hostable via a single `docker-compose`. The only paid cost is the `nekolog.io` domain.

### Architecture at a glance

```
SDKs (browser / node) → HTTPS batch (gzip)
   → Cloudflare Worker "ingest" (Hono) → KV (key→project/env/quota) → ClickHouse (via Tunnel, on Oracle VM)
   Cloudflare Worker "jobs" (cron, 1 min) → alerts/issues/usage/quotas → Resend/Slack/Discord/webhook
   Vercel: Next.js dashboard → Neon Postgres (users/orgs/projects/keys/alerts), Upstash Redis (auth), Resend
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

```
packages/       # published to npm: core, browser, node, react, next, express,
                # fastify, hono, nestjs, pino, winston, cli, bundler-plugin
apps/
  ingest/       # Hono → Cloudflare Workers and Node
  jobs/         # alerts, issues, usage, quotas
  web/          # Next.js dashboard (auth routes, proxy.ts, theme, i18n)
  docs/         # Starlight docs site (native i18n)
internal/       # not published
  auth/         # passwords, OTP codes, tokens, sessions, rate limiting, Lua scripts
  schema/       # ingestion payload format (SDK ↔ ingest contract)
  db/           # Drizzle + Postgres migrations
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
- `pnpm dev` — starts the dev `docker-compose` stack (ClickHouse on :8123, Postgres on :5432, Valkey on :6379, Mailpit on :8025 web UI, MinIO on :9000/:9001) and then `turbo run dev` (currently a no-op — no app defines a `dev` script yet). Copy `.env.example` to `.env` first. `pnpm dev:infra:down` / `pnpm dev:infra:logs` manage the stack directly.
- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` — Turborepo tasks fanning out to every package's own script (currently only `internal/config`, `internal/schema`, `internal/adapters` define any). A package with no matching script is silently skipped by Turbo — that's expected, not a failure.
- `pnpm check` — `biome check --write .` (formats + lints; excludes `**/*.md` and lockfiles — see `biome.json`). CI instead runs `biome ci .` (no writes).
- `pnpm changeset` — add a changeset for a package/app you just changed; `pnpm changeset:status` shows what's pending relative to `dev`.
- To run a single package's tests/typecheck directly: `cd internal/config && pnpm test` or `pnpm --filter @internal/config test`.

## Planned tooling (not yet present in the repo)

- **Tests:** Playwright (e2e, including Mailpit-based auth flows and axe accessibility checks) once `apps/web` exists. Integration tests should run against real ClickHouse/Postgres/Redis as CI services — do not mock the database/ClickHouse for integration-level tests per the project's testing philosophy.
- **Build:** `tsdown` for package builds; `publint` + `@arethetypeswrong/cli` + `size-limit` (browser SDK must stay under 5 KB gzip) checked in CI.
- **ClickHouse migrations:** a custom TypeScript runner (one SQL statement per file in `internal/clickhouse/migrations/`, tracked in a `_migrations` table, forward-only, checksummed — see spec 3 in ESPECIFICACOES.md). Planned commands: `pnpm ch:migrate`, `pnpm ch:status`, `pnpm ch:new <name>`.
- **npm publishing:** Changesets' `release.yml` only maintains the "Version Packages" PR for now; trusted publishing (OIDC) gets wired up once real packages exist to publish.
- **Infra:** OpenTofu under `infra/envs/{dev,qa,prod}`, `tofu plan` on PRs touching `infra/`, `tofu apply` on merge.
- **Deploy:** `wrangler deploy --env <env>` for `apps/ingest` and `apps/jobs`; Vercel Git integration for `apps/web` and `apps/docs`.

## Conventions

- **Commits:** Conventional Commits in English, scoped by package/app (e.g. `feat(core): add batching transport`, `fix(ingest): reject payloads above 512 KB`), enforced by commitlint (`npm-conventional` types only — `security/`-prefixed branches still commit as `chore(security): ...` or similar, not `security(...)`, since `security` isn't a valid commit type).
- **Branches:** one step from ETAPAS.md = one branch off `dev`, prefixed `feat/`, `fix/`, `chore/`, `docs/`, `ci/`, `test/`, `security/`, `infra/`, or `a11y/`. PRs into `dev` squash-merge; promotion `dev→qa→main` uses merge commits (no squash) so branches don't diverge. **This is enforced live, not just convention:** GitHub rulesets on `main`/`qa`/`dev` block deletion/force-push and require PRs + passing status checks (nobody has bypass, not even the repo owner), and `.github/workflows/branch-rules.yml` rejects PRs into `qa`/`main` from the wrong source branch. The `gh` CLI is set up and authenticated in this environment — prefer it (`gh pr create`, `gh pr checks --watch`, `gh pr merge --squash --delete-branch`) over raw GitHub API calls.
- **A step merges only when:** CI is green, new tests cover the change, a changeset exists if a package/app changed, UI strings exist in all three locales, docs are updated for anything public-facing, and (if labeled `security`) the security checklist was followed.
- **i18n:** dashboard, docs, emails, and README ship in pt-BR, en (source/fallback), and es. Code, commits, branches, and PRs are English-only. A CI test must fail if a translation key exists in one locale but not another.
- **Security is the top priority** (docs/PLANO.md §14): parameterized SQL only, permission checks server-side on every route/query, SSRF protections on alert webhooks, CSV export must guard against formula injection, PRs touching `internal/auth`, `apps/ingest`, or permissions get the `security` label and a dedicated review pass.
- **Logs are untrusted input** — anyone with a public key can send arbitrary text. Never render log content with `dangerouslySetInnerHTML`; escape everything.
