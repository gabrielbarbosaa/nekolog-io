# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

This repository currently contains **only planning documentation** — no source code, package manifests, or CI config exist yet (see `docs/ETAPAS.md`, where every step under M0 "Fundação" is still unchecked). Before assuming any build/lint/test command, check whether the relevant files (`package.json`, `pnpm-workspace.yaml`, CI workflows, etc.) actually exist — the commands described below are the **planned** tooling from the docs, not yet-implemented reality.

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

## Planned tooling (not yet present in the repo)

- **Monorepo:** pnpm workspaces + Turborepo, TypeScript, Biome for lint/format.
- **Tests:** Vitest (unit/integration) and Playwright (e2e, including Mailpit-based auth flows and axe accessibility checks). Integration tests run against real ClickHouse/Postgres/Redis as CI services — do not mock the database/ClickHouse for integration-level tests per the project's testing philosophy.
- **Build:** `tsdown` for package builds; `publint` + `@arethetypeswrong/cli` + `size-limit` (browser SDK must stay under 5 KB gzip) checked in CI.
- **ClickHouse migrations:** a custom TypeScript runner (one SQL statement per file in `internal/clickhouse/migrations/`, tracked in a `_migrations` table, forward-only, checksummed — see spec 3 in ESPECIFICACOES.md). Planned commands: `pnpm ch:migrate`, `pnpm ch:status`, `pnpm ch:new <name>`.
- **Local dev stack:** `deploy/docker-compose.dev.yml` (ClickHouse, Postgres, Valkey, Mailpit, MinIO), started via `pnpm dev`.
- **Infra:** OpenTofu under `infra/envs/{dev,qa,prod}`, `tofu plan` on PRs touching `infra/`, `tofu apply` on merge.
- **Deploy:** `wrangler deploy --env <env>` for `apps/ingest` and `apps/jobs`; Vercel Git integration for `apps/web` and `apps/docs`.

## Conventions to follow once code exists

- **Commits:** Conventional Commits in English, scoped by package/app (e.g. `feat(core): add batching transport`, `fix(ingest): reject payloads above 512 KB`), enforced by commitlint.
- **Branches:** one step from ETAPAS.md = one branch off `dev`, prefixed `feat/`, `fix/`, `chore/`, `docs/`, `ci/`, `test/`, `security/`, `infra/`, or `a11y/`. PRs into `dev` squash-merge; promotion `dev→qa→main` uses merge commits (no squash) so branches don't diverge. Never force-push or push directly to `main`/`qa`/`dev`.
- **A step merges only when:** CI is green, new tests cover the change, a changeset exists if a package/app changed, UI strings exist in all three locales, docs are updated for anything public-facing, and (if labeled `security`) the security checklist was followed.
- **i18n:** dashboard, docs, emails, and README ship in pt-BR, en (source/fallback), and es. Code, commits, branches, and PRs are English-only. A CI test must fail if a translation key exists in one locale but not another.
- **Security is the top priority** (docs/PLANO.md §14): parameterized SQL only, permission checks server-side on every route/query, SSRF protections on alert webhooks, CSV export must guard against formula injection, PRs touching `internal/auth`, `apps/ingest`, or permissions get the `security` label and a dedicated review pass.
- **Logs are untrusted input** — anyone with a public key can send arbitrary text. Never render log content with `dangerouslySetInnerHTML`; escape everything.
