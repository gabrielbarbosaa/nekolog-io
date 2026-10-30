---
"@internal/clickhouse": minor
"@internal/config": minor
---

Add the ClickHouse schema and the migration runner.

`internal/clickhouse` ships the `logs` table, the `logs_per_minute` rollup and the
materialized view that feeds it, plus a forward-only runner (`pnpm ch:status`,
`ch:migrate`, `ch:new`) that checksums every applied migration and halts on drift,
on a gap in the numbering, on an out-of-order apply, and on a migration the
database remembers but the repository no longer has.

`internal/config` gains `migrationsEnvSchema` for the DDL credential, and
`loadEnv` now treats a variable set to an empty string as unset, which is what a
`.env` file means by `FOO=`.
