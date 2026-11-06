---
'@internal/auth': patch
'@apps/dashboard': patch
---

Sign-up by invitation, with the e-mail confirmation of section 11.1.

The database stores the SHA-256 of the invitation token, never the token, so
reading the table does not let anyone sign up as somebody else.

**The invitation is not spent at sign-up.** The account is created unconfirmed,
and only the right code marks the account, spends the invitation and creates the
membership — in a single `INSERT ... WITH`, because `SqlRunner` has no
transaction and three separate writes can stop halfway. A test asserts sign-up
touches neither `email_verified_at` nor `memberships`.

The invitation rules — expired, revoked, already accepted, addressed to somebody
else — lived in SQL with no test at all. They now run against a real Postgres.

The code e-mail became `codeEmail` with a purpose, so confirming an address and
signing in no longer share a subject line.
