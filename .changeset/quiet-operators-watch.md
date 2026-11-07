---
'@apps/dashboard': minor
'@internal/auth': minor
'@nekolog-io/db': minor
'@nekolog-io/adapters': patch
---

The operator area: instance invitations, usage per organization, the quotas and
suspension.

It is unlocked per session with the password and locks itself again after
fifteen minutes, because the plan asks for the password every time. Somebody who
is not an operator is answered 404 rather than 403, so the area is never
confirmed to exist.

Organizations now carry a daily event quota and a retention cap, and the cap
binds: an administrator cannot ask for more days than the organization is
allowed, the refusal lives in the `where` of the update rather than only in the
code, and lowering a cap pulls the environments back at once.

Suspending an organization takes its keys out of the list the key sync
publishes, so ingestion stops by the same path a revoked key does. Suspending an
account ends the sessions it is already holding.

An invitation that starts a new organization is sent as `admin`, because the
schema refuses an invite that grants ownership; the rule that every organization
has an owner now lives in the claim, which makes the first person into an
ownerless organization its owner.
