---
"@nekolog-io/clickhouse": minor
"@apps/jobs": minor
---

Back ClickHouse up daily to an object store outside the machine.

`@nekolog-io/clickhouse/backup` is a new entry point that compiles
`BACKUP DATABASE … TO S3(…)`, names each attempt after the moment it was
started, and carries a credential-free form of the statement for anything that
gets logged. `apps/jobs` gains the `clickhouse-backup` task, which asks
`system.backups` what already happened today rather than remembering it:
a finished or running backup means do nothing, a failed one means alert and
retry, and a history it cannot read means alert and start nothing.

The backup runs as `nekolog_backup`, a credential of its own that holds
`BACKUP`, `WRITE ON S3` and `SELECT ON system.backups` — it writes a complete
copy of every log and cannot read one. Configuring it is optional; leaving it
unconfigured makes the jobs container say so on every start, and configuring it
halfway makes it refuse to start.
