# NekoLog

> Logging for JavaScript and TypeScript applications, front-end and back-end.
>
> Read this in [Português (pt-BR)](README.pt-BR.md) or [Español (es)](README.es.md).

[![CI](https://github.com/gabrielbarbosaa/nekolog-io/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/gabrielbarbosaa/nekolog-io/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/gabrielbarbosaa/nekolog-io/badge)](https://scorecard.dev/viewer/?uri=github.com/gabrielbarbosaa/nekolog-io)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

NekoLog takes the logs your application already writes, batches them, strips what
should never leave your process, and stores them somewhere you can search.
SDKs for the browser and for Node, an ingestion API, ClickHouse for storage,
background jobs for alerts and issue grouping, and an HTTP API to read it all
back.

## Status

**Version 1.0, and honest about what that means.**

- Everything in this repository works and is tested: the SDKs, the ingestion,
  the jobs, the public read API, the docs site. `pnpm test` runs it, and CI runs
  it against a real ClickHouse, a real Postgres, a real Redis and a real SMTP
  server on every pull request.
- **Nothing is published to npm yet** and **there is no hosted service.** The
  publishing workflow is wired and sits behind a repository variable that does
  not exist; the infrastructure is written in OpenTofu and has never been
  applied. There is no account to sign up for.
- **What you can do today is run it yourself.** `deploy/self-host` brings up the
  whole platform with one command, and that path is the one this repository
  exists for.
- The **dashboard is closed-source** and is not part of this repository. See
  [What is open and what is not](#what-is-open-and-what-is-not).

It is a personal project, built to run entirely on free-tier cloud services.
The only cost is the domain.

## Run it

```bash
git clone https://github.com/gabrielbarbosaa/nekolog-io
cd nekolog-io/deploy/self-host
./up.sh
```

One command brings up ClickHouse, Postgres, the ingestion, the read API and the
jobs. It generates its own secrets, applies the migrations, mints a project with
an API key, and prints where that key was written. Full guide:
[Run NekoLog yourself](https://nekolog.io/docs/self-host/install/).

Then send something:

```ts
import { createLogger } from '@nekolog-io/node'

const log = createLogger({ apiKey: process.env.NEKOLOG_KEY })

log.info('order placed', { orderId: 'ord_7f3a91', total: 219.9 })
log.error('payment failed', new Error('gateway timeout'))
```

And read it back, with no dashboard involved:

```bash
curl -H "Authorization: Bearer $NEKOLOG_KEY" \
  "http://localhost:8789/v1/logs?q=level:error&limit=20"
```

`q` is a search language, not a substring match:
`level:error service:api @status>=500 "timeout"`. It is described in full in
[the search language](https://nekolog.io/docs/api/search/).

## The SDKs

| Package | For |
|---|---|
| [`@nekolog-io/browser`](packages/browser) | the browser: uncaught errors, rejected promises, breadcrumbs, an offline queue |
| [`@nekolog-io/node`](packages/node) | Node: per-request context, uncaught exceptions, process hooks |
| [`@nekolog-io/react`](packages/react) | provider, `useLogger`, an error boundary |
| [`@nekolog-io/next`](packages/next) | `register()` for `instrumentation.ts`, `onRequestError`, a client entry |
| [`@nekolog-io/express`](packages/express) · [`fastify`](packages/fastify) · [`hono`](packages/hono) · [`nestjs`](packages/nestjs) | request middleware over one shared implementation |
| [`@nekolog-io/pino`](packages/pino) · [`winston`](packages/winston) | bridges for the logger you already use |
| [`@nekolog-io/cli`](packages/cli) | `nekolog init`, releases, source-map upload |
| [`@nekolog-io/bundler-plugin`](packages/bundler-plugin) | Vite, Rollup, webpack and esbuild: upload the maps from inside the build |

If you already run OpenTelemetry, you do not need any of them: the ingestion
takes [OTLP/HTTP](https://nekolog.io/docs/api/otlp/) at `POST /v1/otlp/logs`.

## How it fits together

```
SDKs (browser / node) ──► HTTPS batch, gzipped
         │
         ▼
   ingest (Hono, Cloudflare Workers or Node)
         │   validates · redacts · fingerprints · samples
         ├─► Workers KV            key → project, environment, quota
         └─► ClickHouse            the logs
                 ▲
   jobs (cron, every minute) ──────┘
         alerts · issue grouping · usage and quota · exports
         └─► e-mail, Discord, webhook

   api (read-only)  search · histogram · issues · releases · source maps
```

The ingestion does no I/O beyond the write. Anything that needs a second network
call — alert evaluation, issue building, source-map resolution — runs in the
jobs Worker. The ingestion never touches Postgres or Redis, so a cold database
can never add latency to the path your application waits on.

## What is open and what is not

This repository is MIT and holds the SDKs, the ingestion, the jobs, the public
read API, the landing page and the documentation. **The dashboard — the screens
— is closed-source**, lives in a separate private repository, and runs only on
the hosted service.

That is the open-core line, and it is drawn where it is on purpose: everything
that touches your data, your process and your logs is open and auditable.
Self-host gives you ingestion, storage, search, issue grouping and alerts
through an HTTP API; what it does not give you is a screen to look at them in.
The reasoning is in [docs/PLANO.md](docs/PLANO.md) §1 and
[ADR 0016](docs/adr/0016-pacotes-compartilhados-no-npm.md).

## What it does about your data

- **The IP address is never written.** Not hashed, not truncated. The row
  carries the country, read from a header and validated as two characters. A
  test sends `CF-Connecting-IP` and `X-Forwarded-For` and fails if either
  reaches storage.
- **Sensitive values are stripped inside your process**, before anything is
  sent: by key (`password`, `token`, `authorization`, `secret`, `cpf`, card
  fields, at any depth) and by value in free text (card numbers that pass the
  Luhn check, CPF with a valid check digit, JWTs, `Bearer` credentials, NekoLog
  keys). This runs **after** your own `beforeSend` hook, so a hook cannot undo
  it.
- **And again on the server**, from a closed list of named patterns per
  environment. You cannot supply a regular expression — a third party's regex on
  a Worker with a 10 ms CPU budget is a denial of service you write for
  yourself.
- A click breadcrumb records `button#pay`, never the element's text; `page.url`
  drops the query string, because reset tokens live there.

[What is stored](https://nekolog.io/docs/reference/privacy/) says it in full.

## Numbers, measured rather than claimed

- **`@nekolog-io/core` has zero runtime dependencies**, by contract — and since
  1.0 that is not a promise in prose: every published package ships a CycloneDX
  bill of materials built from the lockfile, and a dependency arriving in
  `core`, `cli` or `adapters` fails the release.
- **The browser SDK does not meet its own size budget.** The target was 5 kB
  gzip; `init` is **12.05 kB** and `createLogger` alone is **9.4 kB**. Most of
  that is the privacy pipeline, which is not optional. The numbers are pinned by
  `size-limit` so they cannot creep, and the miss is written down in
  [docs/PLANO.md](docs/PLANO.md) §9 instead of being rounded away.
- **The biggest batch the protocol allows did not fit a free Cloudflare Worker.**
  500 events with 20% errors and every redaction rule on cost **10.8 ms** of CPU
  against a 10 ms limit — invisible to a load test, which measures latency.
  Memoizing the fingerprint per batch and lowering the client's default batch to
  200 events brought it to 9.1 ms and 2.1 ms. `apps/ingest/src/budget.test.ts`
  guards it in CI.
- Node 22, 24 and 26, Bun, Deno, Chromium, Firefox and WebKit run the suite on
  every pull request — against the **built** package, not the source, because
  that is what you install.

## Documentation

[nekolog.io/docs](https://nekolog.io/docs/) — guides for every SDK, the API
reference, the search language, OTLP, alerts, what is stored, and the self-host
installation, in English, Portuguese and Spanish.

Inside the repository, three documents are the source of truth:

- [docs/PLANO.md](docs/PLANO.md) — the what and the why: architecture, data
  model, APIs, security, operations.
- [docs/ETAPAS.md](docs/ETAPAS.md) — the order it was built in, one step per
  branch per pull request.
- [docs/ESPECIFICACOES.md](docs/ESPECIFICACOES.md) — the binding contracts:
  payload, environment variables, migrations, search grammar, fingerprinting,
  alert rules.

Plus [docs/adr/](docs/adr/README.md) for why each decision was taken and what
was given up, [docs/security/](docs/security/README.md) for the threat model and
the ASVS checklist, and [docs/runbooks/](docs/runbooks/README.md) for what to do
when something breaks.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) has the setup, the conventions and what a
change has to carry to be merged. [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
applies everywhere in the project.

Found a vulnerability? Do not open an issue —
[SECURITY.md](SECURITY.md) has the private reporting path.

## License

[MIT](LICENSE).
