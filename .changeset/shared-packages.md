---
'@nekolog-io/adapters': minor
'@nekolog-io/clickhouse': minor
'@nekolog-io/config': minor
---

Publish the packages both NekoLog repositories need. `internal/adapters`, `internal/clickhouse` and `internal/config` move to `packages/` and become `@nekolog-io/adapters`, `@nekolog-io/clickhouse` and `@nekolog-io/config`, built with tsdown and checked with publint and are-the-types-wrong, so the closed-source dashboard can depend on them instead of carrying a copy.

Inside this repository they still resolve to their TypeScript source. `exports` points at `src/` and the `dist/` mapping lives under `publishConfig`, which pnpm applies when packing, so the migration runner, the seed script and the local ingestion keep running `.ts` directly with no build step.

`@nekolog-io/clickhouse` ships its migrations and a `nekolog-clickhouse` binary, which makes the forward-only runner installable rather than only reachable by cloning the repository. The three are ESM only: their consumers are Node 24, Workers and Next, and the migration runner locates its SQL through `import.meta.url`, which has no honest CommonJS equivalent.

`@nekolog-io/config` now annotates each environment schema explicitly and states its output type by hand rather than inferring it, because TypeScript 7 emits declarations through Oxc and Oxc cannot infer a Valibot expression. The environment contract of each app is now a readable type instead of an inferred one.
