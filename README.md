# NekoLog

> The source of the NekoLog platform. Private and proprietary — see [LICENSE](LICENSE).

NekoLog takes the logs a JavaScript or TypeScript application already writes,
batches them, strips what should never leave the process, and stores them
somewhere searchable. SDKs for the browser and for Node, an ingestion API,
ClickHouse for storage, background jobs for alerts and issue grouping, and an
HTTP API to read it all back.

This file is written for whoever works on the platform. It is in English
because it sits next to the code; the planning documents in [docs/](docs/) are
in Portuguese, and the customer-facing material — the site and the
documentation — is in English, Portuguese and Spanish.

## Who gets what

| Audience | Receives | How |
|---|---|---|
| A customer | the SDK for their stack, and a dashboard login | invitation; the SDK installs from the registry, the dashboard is hosted |
| Whoever works here | this repository | repository access |
| Everyone else | nothing | — |

**The source ships to nobody.** A customer never downloads the platform: they
install a client library into their own application and read their logs in a
dashboard that runs on our instance. The dashboard itself lives in a separate
repository, in `apps/dashboard`.

What that means for the licence is in [LICENSE](LICENSE): everything is
reserved, with one narrow grant so a customer may install the SDK and ship it
inside their own application. [docs/COMERCIAL.md](docs/COMERCIAL.md) is the
plan for the rest of going commercial.

## Status

**Version 1.0, and nothing is deployed.**

- Everything in this repository works and is tested: the SDKs, the ingestion,
  the jobs, the read API, the docs site. CI runs the suite against a real
  ClickHouse, a real Postgres, a real Redis and a real SMTP server on every
  pull request.
- **Nothing is published to a registry.** The publishing workflow is wired and
  sits behind a repository variable that does not exist.
- **No infrastructure has been applied.** It is written in OpenTofu and has
  never run. The target is one VPS — [docs/CUSTOS.md](docs/CUSTOS.md) prices
  the alternatives and says why.
- **The dashboard has seven screens still open**, and without it there is no
  product to sell. It is the critical path, and it is in the other repository.

## Running the whole platform locally

```bash
cd deploy/self-host
./up.sh
```

Six containers: ClickHouse, Postgres, the ingestion, the read API, the jobs,
and a bootstrap that applies both sets of migrations and mints a project with
its keys. It generates its own secrets and prints where the keys were written.

This is the same composition that runs in production, which is the point of it.
Nothing here costs anything to run.

**On Windows it does not work:** `up.sh` is `sh` and needs `openssl`. Write
`deploy/self-host/.env` by hand from `.env.example` and run
`docker compose up -d --build` instead.

For day-to-day work, `pnpm dev` is the one command. It writes a usable `.env`
(generating a real Ed25519 signing key, among other things), brings up
ClickHouse, Postgres, Valkey, Mailpit and Garage, waits for them, applies both
sets of migrations, and then starts every app: the dashboard on :3001, the
ingestion on :8787, the jobs on :8788, the read API on :8789, the site on :3000
and the documentation on :4321/docs. `pnpm dev:doctor` says what is missing when
something does not answer.

A fresh database has no account, and signing up needs an invitation. Open the
first one, which also prints the link:

```bash
pnpm seed init                               # a project, environments and keys
pnpm seed invite --email you@example.com     # the first account
```

Sign up through that link, then run the same command again to be made the owner
of that organisation. From the dashboard you can create your own organisation,
a project, and the key the SDK below needs — it reaches the ingestion within a
minute, which is how long the jobs take to publish it.

Then send something:

```ts
import { createLogger } from '@nekolog-io/node'

const log = createLogger({ apiKey: process.env.NEKOLOG_KEY })

log.info('order placed', { orderId: 'ord_7f3a91', total: 219.9 })
log.error('payment failed', new Error('gateway timeout'))
```

And read it back:

```bash
curl -H "Authorization: Bearer $NEKOLOG_KEY" \
  "http://localhost:8789/v1/logs?q=level:error&limit=20"
```

`q` is a search language, not a substring match:
`level:error service:api @status>=500 "timeout"`. Specification 4 in
[docs/ESPECIFICACOES.md](docs/ESPECIFICACOES.md) is the grammar.

## The SDKs

| Package | For |
|---|---|
| [`@nekolog-io/browser`](packages/browser) | the browser: uncaught errors, rejected promises, breadcrumbs, an offline queue |
| [`@nekolog-io/node`](packages/node) | Node: per-request context, uncaught exceptions, process hooks |
| [`@nekolog-io/react`](packages/react) | provider, `useLogger`, an error boundary |
| [`@nekolog-io/next`](packages/next) | `register()` for `instrumentation.ts`, `onRequestError`, a client entry |
| [`@nekolog-io/express`](packages/express) · [`fastify`](packages/fastify) · [`hono`](packages/hono) · [`nestjs`](packages/nestjs) | request middleware over one shared implementation |
| [`@nekolog-io/pino`](packages/pino) · [`winston`](packages/winston) | bridges for the logger already in use |
| [`@nekolog-io/cli`](packages/cli) | `nekolog init`, releases, source-map upload |
| [`@nekolog-io/bundler-plugin`](packages/bundler-plugin) | Vite, Rollup, webpack and esbuild: upload the maps from inside the build |

A customer already running OpenTelemetry needs none of them: the ingestion
takes OTLP/HTTP at `POST /v1/otlp/logs`.

Four more packages — `adapters`, `clickhouse`, `config` and `db` — are shared
with the dashboard repository. They are server code, so how they reach that
repository is an open question: publishing them to a public registry would
hand out the Postgres schema.

## How it fits together

```
SDKs (browser / node) ──► HTTPS batch, gzipped
         │
         ▼
   ingest (Hono, Cloudflare Workers or Node)
         │   validates · redacts · fingerprints · samples
         ├─► key store              key → project, environment, quota
         └─► ClickHouse             the logs
                 ▲
   jobs (cron, every minute) ──────┘
         alerts · issue grouping · usage and quota · exports
         └─► e-mail, Discord, webhook

   api (read-only)  search · histogram · issues · releases · source maps
```

The ingestion does no I/O beyond the write. Anything needing a second network
call — alert evaluation, issue building, source-map resolution — runs in the
jobs Worker. On Workers the ingestion never touches Postgres, so a cold
database cannot add latency to the path the customer's application waits on.
On a single machine that reason does not hold, and the key store is an open
decision recorded in [docs/COMERCIAL.md](docs/COMERCIAL.md).

## What it does with customer data

This is a product property, not a detail, and it is the strongest thing to say
about the platform:

- **The IP address is never written.** Not hashed, not truncated. The row
  carries the country. A test sends `CF-Connecting-IP` and `X-Forwarded-For`
  and fails if either reaches storage.
- **Sensitive values are stripped inside the customer's process**, before
  anything is sent: by key and by value in free text. This runs **after** their
  own `beforeSend` hook, so a hook cannot undo it.
- **And again on the server**, from a closed list of named patterns per
  environment. A customer cannot supply a regular expression — a third party's
  regex on a Worker with a 10 ms CPU budget is a denial of service written for
  you.
- A click breadcrumb records `button#pay`, never the element's text;
  `page.url` drops the query string, because reset tokens live there.

**Server-side redaction cannot currently be turned on outside the hosted
cloud wiring.** The minimum level, the sample rate and the redaction rules all
live on `environments` in Postgres and never reach the key record the
single-machine ingestion reads. It is tracked as D3 in
[docs/COMERCIAL.md](docs/COMERCIAL.md).

## Numbers, measured rather than claimed

- **`@nekolog-io/core` has zero runtime dependencies**, by contract — and that
  is not prose: every package ships a CycloneDX bill of materials built from
  the lockfile, and a dependency arriving in `core`, `cli` or `adapters` fails
  the release.
- **The browser SDK does not meet its own size budget.** The target was 5 kB
  gzip; `init` is **12.05 kB** and `createLogger` alone is **9.4 kB**. Most of
  that is the privacy pipeline, which is not optional. `size-limit` pins the
  numbers so they cannot creep, and the miss is written in
  [docs/PLANO.md](docs/PLANO.md) §9 instead of being rounded away.
- **The biggest batch the protocol allows did not fit a free Cloudflare
  Worker.** 500 events with 20% errors and every redaction rule on cost
  **10.8 ms** of CPU against a 10 ms limit — invisible to a load test, which
  measures latency. Memoizing the fingerprint per batch and lowering the
  client's default batch to 200 events brought it to 9.1 ms and 2.1 ms.
  `apps/ingest/src/budget.test.ts` guards it.
- Node 22, 24 and 26, Bun, Deno, Chromium, Firefox and WebKit run the suite on
  every pull request — against the **built** package, not the source.

## The documents that decide things

- [docs/PLANO.md](docs/PLANO.md) — the what and the why: architecture, data
  model, APIs, security, operations.
- [docs/ETAPAS.md](docs/ETAPAS.md) — the order it was built in, one step per
  branch per pull request.
- [docs/ESPECIFICACOES.md](docs/ESPECIFICACOES.md) — the binding contracts:
  payload, environment variables, migrations, search grammar, fingerprinting,
  alert rules.
- [docs/COMERCIAL.md](docs/COMERCIAL.md) — what has to happen to charge for
  this, with effort per item.
- [docs/CUSTOS.md](docs/CUSTOS.md) — four architectures with prices.
- [docs/BENCHMARK.md](docs/BENCHMARK.md) — what Splunk, Datadog, Dynatrace and
  Sumo Logic have that this does not, ranked.

Plus [docs/adr/](docs/adr/README.md) for why each decision was taken and what
was given up, [docs/security/](docs/security/README.md) for the threat model
and the ASVS checklist, [docs/runbooks/](docs/runbooks/README.md) for what to
do when something breaks, and [docs/process/branching.md](docs/process/branching.md)
for how a change gets from a branch to production.

## Reporting a vulnerability

[SECURITY.md](SECURITY.md). Not an issue, not a pull request.
