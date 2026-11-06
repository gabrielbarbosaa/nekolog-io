---
'@apps/dashboard': minor
'@internal/auth': minor
---

The proxy renews the access token on its own, checks the Origin of anything that
writes, and hands the session to the rest of the app. The rotation now names the
session's owner, so the renewed token is signed for the account Redis holds
rather than for whatever the refused token claimed.
