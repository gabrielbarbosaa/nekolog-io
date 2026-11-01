---
'@apps/ingest': minor
'@apps/jobs': minor
---

Give both Workers a deployment. Each one gains a `wrangler.json` with a `dev`, `qa` and `prod` environment, and `.github/workflows/deploy-workers.yml` compiles all six with `wrangler deploy --dry-run` on every pull request and publishes on merge, into a protected GitHub environment per branch.

Because wrangler does not interpolate environment variables in its configuration, the committed file carries placeholders and the new `@internal/deploy` fills them in at deploy time. It writes a configuration holding only the environment being deployed, so an environment's values can never reach another one's Worker, and it fails naming every value that is missing or blank instead of publishing a Worker without a binding. Secrets are kept out of that path entirely: their names live in `deploy/workers/secrets.json`, `wrangler secret bulk` uploads them from a file the step deletes, and no value reaches a log or an error message.

Neither Worker is reachable by a `workers.dev` address. The ingestion answers only on the hostnames the plan names, which are now `cloudflare_workers_custom_domain` resources in `infra/modules/environment`; the jobs Worker has no hostname at all and is woken only by its cron. The VM also gets the SSH path step 1.17 left open: a fourth tunnel and an Access application whose single policy is the operator addresses, with still no inbound rule on port 22.
