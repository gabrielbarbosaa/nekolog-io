---
"@apps/ingest": patch
"@apps/api": patch
"@apps/jobs": patch
"@apps/web": patch
"@nekolog-io/clickhouse": patch
"@internal/release": patch
"@internal/infra": patch
---

Delete the infrastructure the VPS replaced, and declare what it actually needs.

`infra/envs/{dev,qa,prod}`, `infra/vercel` and `infra/vm` described Cloudflare
Workers, Workers KV, R2, a Tunnel, Access, three Vercel projects and an ARM
instance on Oracle. None of it was ever applied, and none of it is the design
any more: everything runs in containers on one machine behind a Caddy. The
three roots go, with the nine modules only they used and the `deploy/vm/`
that ran inside the Oracle machine.

The three Workers go with them, because without `infra/envs` they had no
infrastructure left: each app's `wrangler.json` and `worker.ts`, the
`@internal/deploy` package that rendered the configuration and uploaded the
secrets, `deploy/workers/secrets.json`, and the `Workers` workflow. A
`worker.ts` was never only the Worker entry — it also held wiring the Node
entries use — so that part moved rather than disappearing:
`apps/ingest/src/rate.ts`, `apps/api/src/deps.ts` and the jobs' `wiring.ts`.
`@internal/deploy`'s one test that was not about wrangler is now
`internal/release/src/packaging.test.ts`.

In their place, `infra/vps`: one A record per name the self-host Caddyfile
answers on, all proxied by Cloudflare Free, and one R2 bucket for the backups
with a lifecycle rule. The rule expires **only** the `clickhouse/` prefix,
because the Postgres backup deletes its own old files and two retentions over
the same objects would be two truths. The new `@internal/infra` ties both to
the code: it fails if a Caddy site has no record or a record has no site, if
the rule's prefix stops matching `BACKUP_KEY_PREFIX`, or if a root under
`infra/` is not validated, planned and applied by the workflow.

The privacy policy named Oracle, Neon, Upstash and Vercel as processors. They
are gone; Hostinger is there instead, in all three locales.
