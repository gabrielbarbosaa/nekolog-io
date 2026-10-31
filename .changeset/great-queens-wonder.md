---
"@nekolog-io/core": minor
---

Redact `key=value` pairs inside message, error and attribute text.

Key matching used to apply only to attribute keys, so a secret that landed in
the middle of a string instead of becoming an attribute went through untouched:
`POST /login?token=abc123`, `{"password":"hunter2"}`, `authorization: Bearer x`.
That is the most common way a secret leaks into a log by accident.

The same key list drives both, so `privacy.extraKeys` and `privacy.skipKeys`
apply here too. The value ends at the first space, comma, `;`, `&`, `)`, `}` or
`]`, which keeps `?token=abc&user=ana` from swallowing the next parameter, and
an auth scheme word (`Bearer`, `Basic`, `Token`, `Digest`) is taken with the
credential rather than left behind.

An innocent key never swallows the sensitive pair after it: in
`callback failed: ?secret=zzz`, `failed:` does not consume `?secret=zzz` and let
it through. The scan looks for `key<separator>` without reading the value, and
only measures a value once the key is known to be sensitive — which is also
what keeps the cost linear instead of quadratic.

`redactText` takes the key matcher as a new optional third argument; without it
it behaves exactly as before.
