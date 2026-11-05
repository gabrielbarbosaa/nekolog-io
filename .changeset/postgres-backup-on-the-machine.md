---
"@apps/jobs": minor
---

Dump the Postgres from the machine that holds it, not from GitHub Actions.

A `backup` container runs `pg_dump | gzip | age | rclone rcat` as one pipe, so
no readable `.sql` ever exists. It asks the bucket what it already has for the
day instead of remembering anything, and it deletes nothing on a day it failed
to write one. It is a container of its own because a `pg_dump` can take minutes
and a task inside the jobs scheduler would hold every other task for that long.

The move found a bug that had never surfaced: the connection string was passed
whole in `PGDATABASE`, which libpq reads as a database name and not as a URI, so
`pg_dump` ignored the host, user and password and tried the local socket. The
workflow is gated behind a variable that does not exist, so it had never run.
`pgEnvFrom` now splits the URI into the variables libpq actually reads.

`.github/workflows/backup.yml` keeps only the restore test, by hand: restoring
on a different machine than the one that made the backup is the only version of
that test worth running.
