---
'@nekolog-io/adapters': minor
'@nekolog-io/db': minor
'@apps/jobs': minor
---

Run exports on a schedule, and tell the reader when one is ready.

`export-schedule` wakes every minute, works out which period has just closed
and queues an export for every live schedule that has not had that period yet.
The period is always the one that **finished**: the previous UTC day, or the
previous Monday-to-Monday week. It waits fifteen minutes past the boundary so
logs that arrived late still land inside it.

Due-ness is `coalesce(last_run_at, created_at) < boundary`, which gives two
things in one expression: a schedule that already ran for this period is
skipped, and a schedule created *after* a period closed does not export a
period it did not exist for.

The queue is one statement — a CTE that re-checks the schedule is still live
and still due under `FOR UPDATE SKIP LOCKED`, stamps `last_run_at` and inserts
the `exports` row together. Two job runs racing cannot produce two exports of
the same period, and a run that dies cannot stamp a schedule without queueing
anything.

`export-notify` then sends the notice, in the reader's own locale, with a link
and never the file. `exports.notified_at` (migration `0006`) makes the notice
once-only, and `exports_notice_follows_the_file` refuses to record a notice for
an export with no object. The query joins `users` and skips anyone suspended or
unverified.

**The e-mail carries no text anybody typed** — not the export's filter, not the
environment name. Only the period, the row count, the size, the expiry and the
link, all server-derived. That is deliberate: it is what makes the HTML safe
without having to trust escaping inside an e-mail client. The link itself is
built only from an `https` base and an id matching the `exp_` shape, and both
are refused otherwise.
