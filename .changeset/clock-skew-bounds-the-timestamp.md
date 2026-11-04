---
'@nekolog-io/clickhouse': minor
'@apps/ingest': minor
---

Measure the sender's clock at the insert, and stop a wrong one from destroying
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
