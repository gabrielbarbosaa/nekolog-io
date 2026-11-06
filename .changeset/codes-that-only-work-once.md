---
'@internal/auth': patch
---

The e-mail codes of section 11.2: six characters from an alphabet of 31 with no
`0/O` or `1/I/L`, shown as `K7Q-M2P`, read back through lowercase, spaces and
hyphens.

Redis never sees the code. It stores the HMAC-SHA256 of `challenge:code`, so a
code only works in the browser that asked for it, and the Lua compares hashes —
timing the comparison says nothing. A wrong code and a code from another browser
return **the same** answer, because telling them apart would say whether an
attempt is in flight.

Both scripts run against a real Valkey: single use, another browser, the fifth
wrong attempt, expiry by the actual TTL, a new code invalidating the one before,
the resend wait and the sixth send in an hour.

The Lua lives in `src/scripts.ts` rather than `lua/*.lua` as the plan said,
because reading a file beside the module at runtime depends on what Next's
bundler did with the path. The copy of those scripts in the adapter's
integration test is now pinned to this one by a test.
