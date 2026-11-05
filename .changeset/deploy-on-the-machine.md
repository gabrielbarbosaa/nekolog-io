---
"@internal/self-host": patch
---

Make the self-host image small enough to build on the machine that runs it.

The image installed the whole monorepo to run four Node entry points: 1.3 GB of
`node_modules` inside a 2.09 GB image. It now installs the production graph of
`@apps/ingest`, `@apps/api`, `@apps/jobs` and `@internal/seed` — 12.6 MB — plus
`@nekolog-io/db`'s dev dependencies, because the bootstrap migrates Postgres
with drizzle-kit, and deletes the pnpm store afterwards. The image is 1.05 GB.

`deploy/self-host/deploy.sh` is how a new version arrives: it refuses to run
outside a clone, on the wrong branch, or with anything uncommitted,
fast-forwards rather than merges, waits for every container, and prints the
rollback command. `.github/workflows/self-host.yml` builds the image on every PR
that touches it and starts all four entry points.
