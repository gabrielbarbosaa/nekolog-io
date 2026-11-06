---
'@internal/auth': patch
---

Access tokens, refresh tokens and sessions, from section 11.3.

The access token is a ten-minute Ed25519 JWT carrying `sub`, `sid`, `iss`, `aud`
and `exp` — no role, because roles are read on the server so they change
immediately. Its `kid` is the RFC 7638 thumbprint of the key itself, so rotating
needs no extra configuration: the new key joins the list and the old one stays
while tokens from it are still out there.

The refresh token is `{sid}.{secret}` and Redis stores only its SHA-256.
Rotation has four outcomes: rotated, within the thirty-second grace window,
reused — which ends the whole session — and unknown, which is refused **without**
ending anything, because ending it would be a way to sign other people out
knowing only a session id.

Every case section 11.11 lists runs against a real Redis, including ten parallel
requests with the same token.
