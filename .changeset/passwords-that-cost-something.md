---
'@internal/auth': patch
---

`internal/auth` exists, starting with passwords. argon2id at the OWASP minimum —
19 MiB, 2 iterations, parallelism 1 — with the cost read back out of the digest
rather than only asserted as constants.

An address with no account behind it still spends a real argon2 verification, so
"wrong e-mail or password" takes the same time either way. The digest it
verifies against is hashed once and kept: a fake digest string would be refused
on format and return too quickly, which is the leak the delay exists to close.

The Pwned Passwords lookup sends five characters of the SHA-1 and nothing else,
asks for padding so the answer's size says nothing, and gives up after two
seconds. When it cannot be reached the password is **accepted** with
`breachCheck: 'unknown'` — the opposite of the rule used for quota and capacity,
written down in the threat model with the reason.
