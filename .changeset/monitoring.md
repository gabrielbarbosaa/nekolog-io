---
'@apps/jobs': minor
'@apps/web': minor
---

Watch the two things that fill up in silence, and tell an external monitor the jobs are alive. `capacity-watch` counts what is still parked in the R2 spool and reads `system.disks` every five minutes, alerting above 100 pending files or below 15% free — and alerting when it cannot read either one, because an unreadable spool is the state in which the platform is worst, not best. The scheduled run then pings `HEARTBEAT_URL` on success and `…/fail` on failure, so a dead cron and a broken task do not look the same to the monitor; a monitor that is down is logged and never fails the run. `apps/web` answers `/health` with its version.
