---
'@nekolog-io/adapters': minor
'@nekolog-io/db': minor
'@apps/jobs': minor
---

Keep the history of every alert, and hold back a notice that would repeat.

`alert_events` (migration `0009`) records one row per state change, written in
**the same statement** that moves the rule — a CTE that updates `alert_rules`
and inserts the event together, so a run that dies between the two cannot
exist. `on conflict (rule_id, at) do nothing` makes a replay harmless.

The row carries what was measured, the threshold at the time, whether a notice
went out, how many channels took it, and why it did not — `cooldown` or
`no_channel`. Two check constraints keep that honest: a notice cannot be
recorded as sent without a channel, and a suppressed event cannot also claim to
have been sent.

**The cooldown counts from the last firing notice that actually went out**, not
from the last transition, and it holds back **only a firing notice**. The one
that says the alert is over is never held: being told it broke and never told
it was fixed is worse than one message too many. An alert held back is still
recorded, so the screen can say why nobody was told.

A rule whose cooldown holds it back is also stamped as notified, so it is not
weighed again every minute until the window passes.

The task prunes events older than ninety days, oldest first, at most five
hundred per run — a history table with no end is a slow outage.

Specification 6 carries a correction: the rule has **two** states and not
three. "Resolved" is the return to `ok`, and that return is what sends the
all-clear; a third enum value would be a state the rule never rests in.
