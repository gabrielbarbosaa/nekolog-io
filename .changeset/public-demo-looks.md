---
'@apps/dashboard': minor
'@internal/auth': minor
'@internal/seed': minor
'@nekolog-io/db': minor
---

The public demo: `/demo` opens a read-only session in an organization that
already has logs in it, with no password and no e-mail.

Read-only is guaranteed twice over. The demo account is a viewer of its
organization, so the permission matrix already refuses every organization
write; on top of that the gate refuses one with `demo_is_read_only` even if a
viewer were ever given a write permission. What the role did not cover has a
gate of its own: creating an organization, changing the password or the e-mail,
ending every session, and listing the sessions — that last one because the
account is shared, and the list would show other visitors' device and country.

A test classifies every route under `app/api` and fails on one that writes
without passing through a gate that knows about the demo.

`pnpm seed demo` creates the organization and fills ClickHouse with a day of
plausible logs, then checks how many survived the insert.
