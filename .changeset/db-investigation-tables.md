---
'@nekolog-io/db': minor
---

Add the Postgres tables M4 needs: `saved_views`, `dashboards`, `releases`, `exports` and `export_schedules`. They live here even when only the dashboard reads them, because both repositories write to this database and a duplicated schema is the one divergence no test on either side can catch.

Every table that carries both a project and an environment uses a **composite** foreign key to `environments (id, project_id)` rather than two separate ones. With two separate keys nothing stops a row of project A pointing at an environment of project B — each key is valid on its own — which is cross-tenant leakage written into the schema. That needs a unique index on `environments (id, project_id)`, which ships as its own migration before the tables, because a foreign key created before the index it needs is refused on apply.

The rules that matter are check constraints, not application code: an export cannot say it is `ready` without an object key or `failed` without a reason, its object key has to stay under the `exports/` prefix and may not contain `..`, its period has to move forward and it has to expire after it was asked for; a release version is trimmed and bounded and a `commit` has to look like one; a saved view or a dashboard may only hold one **shared** name per project, so two people can each keep a private "My errors"; and one live schedule per cadence per environment.
