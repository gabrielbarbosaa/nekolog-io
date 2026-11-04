---
'@apps/jobs': minor
---

Tell the operator when the platform itself is in trouble.

The three signals this codebase already raised went only to the Worker log,
where nobody is watching at three in the morning. They now also reach
`OPS_DISCORD_WEBHOOK_URL`, through the same SSRF guard, `redirect: 'manual'`
and five-second deadline as a tenant's own webhook in 5.2 — an operator channel
is still an address somebody typed.

The mapping is deliberate about severity. **"I cannot measure" is critical**,
the same rule `quota-block` and `capacity-watch` already follow internally: a
disk reading that failed is not a healthy disk. A batch replayed but **not
deleted** is critical too, because the next run writes it again. A filling
spool, a quarantined batch and a blocked environment are warnings. An
environment let back in after a block raises nothing, and a spooled batch that
replayed as intended raises nothing.

Three refusals: the alert is **always written to the log**, whether or not it
was delivered, so the channel failing does not lose the signal; the notifier
**never throws back** into the task that raised it; and with no webhook
configured it says so rather than failing silently.

`OPS_DISCORD_WEBHOOK_URL` is registered as a Worker **secret**, not a var — it
is a URL that anyone holding it can post to.
