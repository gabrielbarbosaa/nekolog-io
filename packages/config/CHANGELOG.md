# @nekolog-io/config

## 1.0.0

### Major Changes

- Leave `0.x`.
  
  Nothing in this release breaks anything, because there is nothing to break: no
  version of any of these packages has ever been published. The major is what
  `0.x` means being over — from here the promises on
  [versioning and support](https://nekolog.io/docs/reference/versioning/) hold.
  A breaking change to the HTTP API becomes `/v2` and `/v1` keeps answering for at
  least six months; the ingestion accepts the two most recent `schemaVersion`
  values; anything being removed from a package gets a console warning and a
  changelog entry at least one minor before it goes.
  
  Two things changed in the code to make that a promise and not a sentence.
  
  **Every published package now ships a CycloneDX bill of materials**, written
  from the lockfile at release time and attached to that package's own GitHub
  Release. The documents list what the package brings, not what the application
  already has, and a check refuses a release where one is missing, left over from
  the version before, or describes something this release does not publish. Three
  of them — `core`, `cli` and `adapters` — promise **no runtime dependencies at
  all**, and that promise used to live only in prose; the bill of materials now
  answers it, so a transitive dependency arriving through a package they already
  use fails the release instead of shipping.
  
  **Publishing uses npm trusted publishing**, so there is no npm token in this
  repository or in GitHub to leak, and every tarball carries provenance naming the
  commit and the workflow that built it.
  
  `apps/api` and `apps/ingest` now answer `/health` with the version they were
  deployed as, the way `apps/jobs` already did — the plan has said the version
  shows at `/health` since the beginning, and on two of the three it did not.

### Minor Changes

- [#30](https://github.com/gabrielbarbosaa/nekolog-io/pull/30) [`8f4f90a`](https://github.com/gabrielbarbosaa/nekolog-io/commit/8f4f90abe551c5a149f8fba913bb95483e45d28d) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add the ClickHouse schema and the migration runner.
  
  `internal/clickhouse` ships the `logs` table, the `logs_per_minute` rollup and the
  materialized view that feeds it, plus a forward-only runner (`pnpm ch:status`,
  `ch:migrate`, `ch:new`) that checksums every applied migration and halts on drift,
  on a gap in the numbering, on an out-of-order apply, and on a migration the
  database remembers but the repository no longer has.
  
  `internal/config` gains `migrationsEnvSchema` for the DDL credential, and
  `loadEnv` now treats a variable set to an empty string as unset, which is what a
  `.env` file means by `FOO=`.

- [#132](https://github.com/gabrielbarbosaa/nekolog-io/pull/132) [`a128738`](https://github.com/gabrielbarbosaa/nekolog-io/commit/a1287384af7a0d59f159639708dbcbdd34caf2bd) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Publish the packages both NekoLog repositories need. `internal/adapters`, `internal/clickhouse` and `internal/config` move to `packages/` and become `@nekolog-io/adapters`, `@nekolog-io/clickhouse` and `@nekolog-io/config`, built with tsdown and checked with publint and are-the-types-wrong, so the closed-source dashboard can depend on them instead of carrying a copy.
  
  Inside this repository they still resolve to their TypeScript source. `exports` points at `src/` and the `dist/` mapping lives under `publishConfig`, which pnpm applies when packing, so the migration runner, the seed script and the local ingestion keep running `.ts` directly with no build step.
  
  `@nekolog-io/clickhouse` ships its migrations and a `nekolog-clickhouse` binary, which makes the forward-only runner installable rather than only reachable by cloning the repository. The three are ESM only: their consumers are Node 24, Workers and Next, and the migration runner locates its SQL through `import.meta.url`, which has no honest CommonJS equivalent.
  
  `@nekolog-io/config` now annotates each environment schema explicitly and states its output type by hand rather than inferring it, because TypeScript 7 emits declarations through Oxc and Oxc cannot infer a Valibot expression. The environment contract of each app is now a readable type instead of an inferred one.
