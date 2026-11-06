---
'@apps/dashboard': minor
'@internal/auth': patch
---

The dashboard has screens. Signing in, signing up through an invitation,
confirming an address and recovering a password all happen on a page now
instead of through `fetch` in a test. Behind them: the projects list, a project's
environments with every setting from step 2.15, the keys from 2.16 with the one
showing, the members and invitations of an organisation, and the account screen
with the sessions it is signed in on.

Two guards came out of building it. No client component may import
`@internal/auth`, `@nekolog-io/adapters`, `postgres`, `ioredis` or `nodemailer`
as a value — the first attempt carried argon2 into the browser bundle and the
build is what caught it. And every error code a route can answer has a sentence
in all three languages, derived from the routes themselves rather than written
down, so a new refusal cannot reach a screen as "something went wrong".
