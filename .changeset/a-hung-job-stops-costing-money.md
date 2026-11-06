---
'@internal/release': patch
---

Every job in every workflow now declares `timeout-minutes`. GitHub's default is
six hours, and the browser install step of the compatibility matrix has hung
three times — on a private repository those are metered minutes nobody spent on
purpose. `workflow.test.ts` fails if a job has no ceiling, or if one is raised
past thirty minutes.
