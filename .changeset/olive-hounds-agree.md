---
'@apps/dashboard': minor
'@internal/auth': minor
---

Organizations, invitations and roles, with the permission matrix of section 10.2
in one file the tests read out of the plan itself. Every organization route goes
through one guard that reads the role from the database for this person, and
answers 404 — not 403 — to somebody who is not a member.
