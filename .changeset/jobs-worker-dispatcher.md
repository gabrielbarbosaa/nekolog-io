---
"@apps/jobs": minor
---

Add the scheduled Worker: one cron per environment, every task behind it.

Cloudflare allows five Cron Triggers per account and NekoLog has three
environments, so one trigger per environment fires every minute and the
dispatcher decides what is due. Due-ness is arithmetic over the scheduled time
(`(minute - offset) % everyMinutes === 0`) rather than remembered state, because
a Worker isolate does not survive between runs — a "last run" variable would
work in dev and quietly misfire in production. `offsetMinutes` keeps two tasks
of the same cadence off the same tick.

A task that throws cannot stop the others, and one that hangs cannot hold the
tick: each gets a deadline capped by the whole run's budget, and its
`AbortSignal` is aborted when the deadline passes, so a `fetch` made with it is
really cancelled. Tasks run in parallel because they are all I/O. The run never
rejects; it produces one JSON summary line with what ran, what was skipped and
what failed.

`scheduled` throws after reporting the summary, so a run with failures shows red
in Cloudflare's Cron Events instead of green with a sad log line.

`/health` answers with the version and the number of registered tasks. There is
no route that triggers a task, and a test fails if one is added. It deliberately
does not report the last run: the isolate answering `/health` is rarely the one
that ran the cron, so it would claim "never ran" while everything is fine.

`startScheduler` runs the same dispatcher off Cloudflare, aligned to the clock
minute, re-queued each tick instead of a drifting interval, and refusing to
start a run while the previous one is still going.

No task is registered yet: 1.11 and 1.12 add the first ones.
