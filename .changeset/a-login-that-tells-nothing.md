---
'@internal/auth': patch
'@apps/dashboard': patch
'@nekolog-io/config': patch
---

The login of section 11.1: `login/start`, `login/verify` and `login/resend` on
the dashboard, thin routes over `@internal/auth`.

A wrong password and an address with no account answer the same way and take the
same time. Five failures per account and twenty per address in fifteen minutes,
with the wait growing 1 → 2 → 4 → 8 → 15; the **fifth** failure already blocks,
which is what "5 wrong passwords activate a wait" means. The code e-mail goes
out after the response, so the response time says nothing about the password.

Turnstile sits behind `TURNSTILE_SECRET_KEY`, the way `INFRA_ENABLED` does: with
no key the check answers `off` without touching the network, and with one it
runs — and fails closed on any error. A test fails if the login route stops
calling it, so turning it on is a variable and nothing else.

`webEnvSchema` became `dashboardEnvSchema` and lost the `CF_*` fields whose
infrastructure was deleted in D4 and `AUTH_JWT_KID`, which stopped being needed
when the `kid` became the key's own thumbprint.
