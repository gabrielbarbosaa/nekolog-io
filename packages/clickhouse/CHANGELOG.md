# @nekolog-io/clickhouse

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

- [#169](https://github.com/gabrielbarbosaa/nekolog-io/pull/169) [`618747a`](https://github.com/gabrielbarbosaa/nekolog-io/commit/618747a8ac888a1eb35e64ee9505189404f3d8f8) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Evaluate alert rules, all of an environment's in one query.
  
  Specification 6's five types are here: `threshold`, `error_rate`, `new_issue`,
  `issue_regression` and `absence`. `alert_rules` (migration `0007`) holds the
  condition as JSON; `parseAlertCondition` in `@nekolog-io/adapters` reads it, and
  both repositories use that one reader rather than two that can drift.
  
  **The free Worker allows 50 subrequests per run, so the query count is the
  design.** `@nekolog-io/clickhouse/alerts` compiles every measurable rule of one
  environment into a **single** statement: one `countIf` per rule, each carrying
  its own window and its own compiled search, over one scan bounded by the widest
  window. Twenty rules in an environment cost one ClickHouse call, not twenty.
  Each rule's search parameters are renamed `r<n>_p<m>`, so two rules in the same
  batch cannot collide — and the builder refuses rather than overwrite if they
  ever did.
  
  `new_issue` and `issue_regression` never touch ClickHouse at all: they count
  rows in `issues` that opened or regressed inside the window.
  
  **The condition no longer carries an environment, and the schema refuses one.**
  Specification 6's example had `"environment": "production"` inside the JSON.
  The environment is the `environment_id` column, which is half of the composite
  foreign key to `environments (id, project_id)` — the thing that stops a rule of
  one project pointing at another project's environment. A second copy inside the
  JSON would be a second truth no constraint can reach, so
  `alert_rules_condition_carries_no_environment` rejects it. The spec carries the
  correction.
  
  A rule's state lives on the rule (`ok`/`firing`, with `state_changed_at`), and
  the evaluator only writes when it *changes*, in one batched `UPDATE`. A rule
  that was disabled since it was read is never moved. `alert_events` and the
  cooldown are 5.3's, next to the code that writes them — 4.6's lesson again.
  
  Two refusals worth naming: a measurement that failed **never resolves** a firing
  rule, because "I could not measure" is not "it stopped"; and a stored condition
  that no longer parses throws instead of being evaluated as a guess.

- [#162](https://github.com/gabrielbarbosaa/nekolog-io/pull/162) [`d208afb`](https://github.com/gabrielbarbosaa/nekolog-io/commit/d208afbe1996141286ff133872841e5341621d1b) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add `logContextQuery` to `@nekolog-io/clickhouse/search`: the logs before a chosen one, the ones sharing its moment, and the ones after, as a single query with a `context_side` column of `-1`, `0` and `1`.
  
  The anchor is a **moment, not a row**, and that is the table's limit rather than a choice: `logs` has no row identity, its sort key is `(project_id, environment_id, timestamp)`, and nothing separates two rows written in the same millisecond. Everything tied with the anchor therefore comes back together in the middle group, capped by `atMost`. Inventing an order the data does not have would be worse than showing the three lines.
  
  The window exists so the partitions can be pruned: the table is partitioned by `toYYYYMMDD(timestamp)`, and without a range "the 25 rows before" scans history until it finds 25. It defaults to an hour on each side and is capped at seven days.
  
  Columns come from a closed list — that is the one part of the query that cannot be a parameter — and `retention_days` is deliberately not on it. The database and table names go through the same `assertIdentifier` the `LogStore` uses.

- [#30](https://github.com/gabrielbarbosaa/nekolog-io/pull/30) [`8f4f90a`](https://github.com/gabrielbarbosaa/nekolog-io/commit/8f4f90abe551c5a149f8fba913bb95483e45d28d) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add the ClickHouse schema and the migration runner.
  
  `internal/clickhouse` ships the `logs` table, the `logs_per_minute` rollup and the
  materialized view that feeds it, plus a forward-only runner (`pnpm ch:status`,
  `ch:migrate`, `ch:new`) that checksums every applied migration and halts on drift,
  on a gap in the numbering, on an out-of-order apply, and on a migration the
  database remembers but the repository no longer has.
  
  `internal/config` gains `migrationsEnvSchema` for the DDL credential, and
  `loadEnv` now treats a variable set to an empty string as unset, which is what a
  `.env` file means by `FOO=`.

- [#161](https://github.com/gabrielbarbosaa/nekolog-io/pull/161) [`b602f0b`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b602f0b4c75810a70ab527c1a6b18501a2367e86) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add the search language of specification 4 as a new `@nekolog-io/clickhouse/search` entry: `parseSearch` turns the text into an AST, `compileSearch` turns the AST into SQL, and `searchWhere` wraps that in the project, environment and period filter the server always adds. It lives here rather than in the dashboard because both repositories need the same language, and a second implementation of one grammar diverges on the first corner case.
  
  Nothing a person types reaches the SQL. Every value is a parameter, **including the attribute name** — `@orderId` becomes `attributes[{p1:String}]`, never `attributes['orderId']`, which would be the one injection point in the whole translation. A field that does not exist is an error carrying its position in the text, never a column name arriving from outside. The user's filter always goes in brackets, even when it is a single condition, so no precedence can reach the scope's `AND`; scope parameters are prefixed `s_` and search parameters are always `p<n>`, and `searchWhere` refuses rather than builds if those ever meet. An empty environment list or a reversed period is refused too: a scope that does not scope is a bug, not a filter.
  
  Two behaviours worth knowing: `env:` takes an environment **name** and emits an **id**, so it needs the caller's name-to-id map and errors without one, while a name that is not in the map matches nothing rather than erroring; and only a word of `[A-Za-z0-9_]` goes through `hasToken`, because `hasToken` raises when the needle holds a separator — everything else, and every quoted phrase, goes through `positionCaseInsensitive`.

- [#165](https://github.com/gabrielbarbosaa/nekolog-io/pull/165) [`89acf84`](https://github.com/gabrielbarbosaa/nekolog-io/commit/89acf8414914d70de158d09c0cd03afc5574a305) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Measure the sender's clock at the insert, and stop a wrong one from destroying
  the log.
  
  `logs` gains `clock_skew_ms Int64` (migration `0006`), written by the ingestion
  as `received_at - timestamp`: positive when the sender is behind, negative when
  it runs ahead. It is the column the dashboard's five-minute warning reads.
  
  Marking the row is not enough on its own, because the row may not survive. The
  table partitions by `toYYYYMMDD(timestamp)` and its `TTL` is
  `timestamp + retention_days`, and `timestamp` belongs to the client. A clock set
  further back than the retention makes ClickHouse **drop the row at the insert** —
  the partition appears with zero rows and nothing is reported. A clock set
  forward writes into a partition no period query reaches and whose `TTL` only
  expires after it, which is retention evasion (threat T10).
  
  So the stored `timestamp` is bounded to
  `[received_at - (retention_days - 1h), received_at + 5min]`. The hour of margin
  keeps a merge from eating the row moments later, the floor follows the
  environment's own retention rather than a fixed window, and the five minutes
  ahead leave ordinary NTP drift alone. A replay from the browser's offline queue,
  up to seven days old, is untouched on a thirty-day retention.
  
  `clock_skew_ms` always records the real distance, bound or not, so the original
  is exactly `received_at - clock_skew_ms` — which is why it is `Int64` and not
  `Int32`: a clock set to 2099 is 2.2e12 ms away, and an `Int32` of milliseconds
  stops at 24 days.
  
  `LOG_COLUMNS` carries the new column, and a test now rebuilds the list from the
  migrations — `CREATE TABLE` plus every later `ADD COLUMN` — so the closed list
  cannot drift from the table. The same parser replaced the one in the ingestion's
  row test, which only ever read `0001_create_logs.sql` and would have missed any
  column added afterwards.

- [#166](https://github.com/gabrielbarbosaa/nekolog-io/pull/166) [`30b6d0e`](https://github.com/gabrielbarbosaa/nekolog-io/commit/30b6d0e6976d67bc94fa166e49b2357d6cacba02) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Generate exports in ClickHouse and write them straight to the object store.
  
  `@nekolog-io/clickhouse/export` is a sixth entry point. `compileExport` builds
  an `INSERT INTO FUNCTION s3(...) SELECT ... FROM logs WHERE ...` in JSON
  (NDJSON), XML or CSV, gzipped, scoped by the same `searchWhere` the Explorer
  uses, so the project, the environment, the period and the reader's filter are
  all bound parameters and none of them is ever interpolated.
  
  **The CSV guard covers every text column, and the classification is the test.**
  A cell beginning `=`, `+`, `-`, `@`, a tab or a CR is prefixed with a quote, so
  a logged `=cmd|/c calc` opens as text rather than running. Rather than listing
  the columns to guard, the module splits the whole table into text and non-text
  and a test asserts the two lists together are exactly `LOG_COLUMNS` — a column
  added later cannot slip through unguarded. JSON and XML are left alone, where a
  leading equals sign means nothing and prefixing would corrupt the value.
  
  **Three things the dev ClickHouse had to be asked rather than assumed.** A
  write needs `s3_truncate_on_insert = 1`, because the existence check ClickHouse
  does otherwise fails against an S3 that is not AWS — and truncating is right
  anyway, since a retry must overwrite its own object rather than fail. An export
  that matches no rows writes **no object at all**, so the jobs task places a
  twenty-byte empty gzip itself; `ready` has to mean there is something to
  download, which is what the `exports_ready_means_there_is_an_object` constraint
  promises. And the credentials travel inside the statement: ClickHouse masks the
  secret in `query_log` as `[HIDDEN]`, but it does not mask error text, so the
  task strips the key and the secret from anything it writes into `failure`.
  
  `ExportStore` lands in `@nekolog-io/adapters` with a memory and a SQL
  implementation. The claim is a single `UPDATE ... FOR UPDATE SKIP LOCKED`, so
  two runs never take the same export, and it also takes back an export whose run
  plainly died — which needed a new `started_at` column (migration `0005`) and a
  `exports_running_means_it_started` check, because without it a Worker that died
  mid-export left the row `running` for ever and the reader got neither a file
  nor an error.
  
  The `nekolog_jobs` ClickHouse user gains `WRITE ON S3` and
  `CREATE TEMPORARY TABLE` — the second because a table function does not exist
  without it — and deliberately **not** `READ ON S3`: it can write an export and
  cannot read any object back into the database. `grants.test.ts` pins both
  halves.
  
  `infra/modules/r2-buckets` gains the `nekolog-exports-<env>` bucket with a
  seven-day lifecycle rule, which is what actually deletes the files; the jobs
  task marks the rows `expired` and deletes the objects it can, and the bucket
  rule is the backstop for the ones it cannot.

- [#42](https://github.com/gabrielbarbosaa/nekolog-io/pull/42) [`86b2503`](https://github.com/gabrielbarbosaa/nekolog-io/commit/86b2503df4369cab7e39ad25a399b05185d3802b) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add the `RateLimiter` and `QuotaStore` adapters behind the per-environment rate limit and the daily quota block, and the `usage_per_minute` rollup they read.
  
  Usage is counted from `usage_per_minute`, grouped by `received_at`, instead of `logs_per_minute`, which groups by the client-supplied `timestamp` — a quota built on the latter could be dodged by backdating events. The ingestion Worker's ClickHouse user needs `SELECT(received_at)` on `logs` before the migration applies.

- [#164](https://github.com/gabrielbarbosaa/nekolog-io/pull/164) [`ae94827`](https://github.com/gabrielbarbosaa/nekolog-io/commit/ae9482719f1cfde887a387e7608e0d8fa6a652cb) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add the pieces an issue is made of. `@nekolog-io/adapters` gains the `IssueStore` contract with a memory implementation and `sqlIssueStore`, which takes an injected query runner rather than a driver, the way the Redis adapters take a client — so the package still has no runtime dependency. `@nekolog-io/clickhouse/issues` groups error rows by project, environment and fingerprint. `@nekolog-io/db` gains `issues` and `issue_environments`, because specification 5 says an issue is a project plus a fingerprint, counted per environment.
  
  Three rules live in the store rather than in whatever calls it. First seen never moves forward and last seen never moves backward, however out of order the occurrences arrive. An issue that was **resolved** and then happens again is reopened and stamped `regressed_at` — but only when the occurrence is newer than the fix, so a late batch from before the fix does not undo it. An issue somebody chose to **ignore** is never reopened, which is what ignoring means.
  
  The rollup windows by `received_at`, never by the `timestamp` the client chose, for the same reason `usage_per_minute` does: a sender that backdates its events would otherwise fall outside every window and never be grouped. The fingerprint travels as text the whole way — a `UInt64` does not fit in a JavaScript number, and `18446744073709551615` has to survive ClickHouse, the store and the Postgres column unchanged.

- [#179](https://github.com/gabrielbarbosaa/nekolog-io/pull/179) [`d820891`](https://github.com/gabrielbarbosaa/nekolog-io/commit/d8208913e2b35a86132d94fc6a816636141a3896) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Read the logs back without the dashboard.
  
  `@nekolog-io/clickhouse/search` gains `logSearchQuery` and `logHistogramQuery`,
  the two statements a reader needs beside the `searchWhere` that was already
  there. The histogram's bucket comes from a closed list and is rendered as a
  literal number of seconds, so a caller cannot put anything of their own next to
  `INTERVAL`, and a period that would produce more than 1 500 points is refused
  rather than run.
  
  `@nekolog-io/adapters` gains `IssueReader` and `sqlIssueReader`: `IssueStore`
  could only write. It joins `issue_environments`, so an issue is scoped to the
  environment that actually saw it, and it pages by cursor on `(last_seen_at, id)`
  rather than by offset.
  
  **`queryRows` now asks ClickHouse to quote 64-bit integers, and that is a bug
  fix.** A `UInt64` does not fit in a JavaScript number: a real fingerprint came
  back from a running stack as `9798706835935588000` instead of
  `9798706835935588174`, because the server answered with an unquoted number and
  `JSON.parse` rounded it. Every reader in this repository is JavaScript, so the
  safe shape is the default; a caller that genuinely wants a number — the usage
  store counting events — passes `output_format_json_quote_64bit_integers: '0'`
  itself, as it already did.

- [#132](https://github.com/gabrielbarbosaa/nekolog-io/pull/132) [`a128738`](https://github.com/gabrielbarbosaa/nekolog-io/commit/a1287384af7a0d59f159639708dbcbdd34caf2bd) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Publish the packages both NekoLog repositories need. `internal/adapters`, `internal/clickhouse` and `internal/config` move to `packages/` and become `@nekolog-io/adapters`, `@nekolog-io/clickhouse` and `@nekolog-io/config`, built with tsdown and checked with publint and are-the-types-wrong, so the closed-source dashboard can depend on them instead of carrying a copy.
  
  Inside this repository they still resolve to their TypeScript source. `exports` points at `src/` and the `dist/` mapping lives under `publishConfig`, which pnpm applies when packing, so the migration runner, the seed script and the local ingestion keep running `.ts` directly with no build step.
  
  `@nekolog-io/clickhouse` ships its migrations and a `nekolog-clickhouse` binary, which makes the forward-only runner installable rather than only reachable by cloning the repository. The three are ESM only: their consumers are Node 24, Workers and Next, and the migration runner locates its SQL through `import.meta.url`, which has no honest CommonJS equivalent.
  
  `@nekolog-io/config` now annotates each environment schema explicitly and states its output type by hand rather than inferring it, because TypeScript 7 emits declarations through Oxc and Oxc cannot infer a Valibot expression. The environment contract of each app is now a readable type instead of an inferred one.

### Patch Changes

- Updated dependencies [[`5d67dc0`](https://github.com/gabrielbarbosaa/nekolog-io/commit/5d67dc0318a0ba23ecbb554dc14292ea2cd8fa90), [`3e68c91`](https://github.com/gabrielbarbosaa/nekolog-io/commit/3e68c91097c28d0d97bd4d081b438f0f08147cb2), [`618747a`](https://github.com/gabrielbarbosaa/nekolog-io/commit/618747a8ac888a1eb35e64ee9505189404f3d8f8), [`8f4f90a`](https://github.com/gabrielbarbosaa/nekolog-io/commit/8f4f90abe551c5a149f8fba913bb95483e45d28d), [`0be573f`](https://github.com/gabrielbarbosaa/nekolog-io/commit/0be573f78ab92d86dd2af5c40ad833103063e87d), [`23264a8`](https://github.com/gabrielbarbosaa/nekolog-io/commit/23264a81e09a9449e5b8f1bd4f65f6c41a658b1f), [`30b6d0e`](https://github.com/gabrielbarbosaa/nekolog-io/commit/30b6d0e6976d67bc94fa166e49b2357d6cacba02), [`b13b20c`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b13b20c04481823623f81f356a8f7d754bb8b995), [`86b2503`](https://github.com/gabrielbarbosaa/nekolog-io/commit/86b2503df4369cab7e39ad25a399b05185d3802b), [`ae94827`](https://github.com/gabrielbarbosaa/nekolog-io/commit/ae9482719f1cfde887a387e7608e0d8fa6a652cb), [`2ab714b`](https://github.com/gabrielbarbosaa/nekolog-io/commit/2ab714b4f393f46e90dc50f5dff3f8ca3bc569c5), [`d820891`](https://github.com/gabrielbarbosaa/nekolog-io/commit/d8208913e2b35a86132d94fc6a816636141a3896), [`c95a2d5`](https://github.com/gabrielbarbosaa/nekolog-io/commit/c95a2d5b337048cadacb049d243bdb4bf04594f2), [`3d886b1`](https://github.com/gabrielbarbosaa/nekolog-io/commit/3d886b1df376eae7d24e06cfee29ba00d36b3bc5), [`72eaba5`](https://github.com/gabrielbarbosaa/nekolog-io/commit/72eaba5c6ab14a56fc4341ba77112970ad7ebbb5), [`b1f4a7d`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b1f4a7de5a67637bdde6b9b79335190d2f3c9b26), [`7985ce7`](https://github.com/gabrielbarbosaa/nekolog-io/commit/7985ce7c4683c6e7c7ed21d0b44a21d594d2b3c2), [`a128738`](https://github.com/gabrielbarbosaa/nekolog-io/commit/a1287384af7a0d59f159639708dbcbdd34caf2bd), [`d6029f2`](https://github.com/gabrielbarbosaa/nekolog-io/commit/d6029f290ed1faf4151d9356ba87c77b148710bc)]:
  - @nekolog-io/adapters@1.0.0
  - @nekolog-io/config@1.0.0
