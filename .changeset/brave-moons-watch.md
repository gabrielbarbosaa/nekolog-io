---
'@apps/dashboard': patch
---

The section 11.11 list runs in a real browser: fifteen Playwright tests over the
codes, the sessions and the cookies, reading their codes from Mailpit. A new CI
job runs them in the Playwright container against Postgres, Valkey and Mailpit.
