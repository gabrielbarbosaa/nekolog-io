---
'@nekolog-io/clickhouse': minor
'@nekolog-io/adapters': minor
'@nekolog-io/db': minor
'@apps/jobs': minor
---

Evaluate alert rules, all of an environment's in one query.

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
