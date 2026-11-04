---
'@nekolog-io/clickhouse': minor
'@nekolog-io/adapters': minor
'@nekolog-io/db': minor
'@apps/jobs': minor
---

Generate exports in ClickHouse and write them straight to the object store.

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
