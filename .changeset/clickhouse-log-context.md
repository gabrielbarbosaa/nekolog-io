---
'@nekolog-io/clickhouse': minor
---

Add `logContextQuery` to `@nekolog-io/clickhouse/search`: the logs before a chosen one, the ones sharing its moment, and the ones after, as a single query with a `context_side` column of `-1`, `0` and `1`.

The anchor is a **moment, not a row**, and that is the table's limit rather than a choice: `logs` has no row identity, its sort key is `(project_id, environment_id, timestamp)`, and nothing separates two rows written in the same millisecond. Everything tied with the anchor therefore comes back together in the middle group, capped by `atMost`. Inventing an order the data does not have would be worse than showing the three lines.

The window exists so the partitions can be pruned: the table is partitioned by `toYYYYMMDD(timestamp)`, and without a range "the 25 rows before" scans history until it finds 25. It defaults to an hour on each side and is capped at seven days.

Columns come from a closed list — that is the one part of the query that cannot be a parameter — and `retention_days` is deliberately not on it. The database and table names go through the same `assertIdentifier` the `LogStore` uses.
