---
'@nekolog-io/adapters': minor
'@nekolog-io/db': minor
'@apps/jobs': minor
---

Deliver alerts to e-mail, Slack, Discord and signed webhooks.

`alert_channels` (migration `0008`) holds the four kinds, and `alert-notify`
sends a rule's notice to every channel it names, in the channel's own locale,
once per state change — `last_notified_at` against `state_changed_at` is what
makes it once. 5.1's `last_measured` column lands here too, because a notice
that cannot say what was measured is not what specification 6 asks for.

**The SSRF guard is the heart of this change, and it runs twice.**
`assertWebhookTarget` refuses anything that is not `https` on port 443, an
address carrying credentials, `localhost`, `*.local`, `*.internal`, `*.lan`,
`*.home.arpa`, `*.in-addr.arpa`, the cloud metadata hosts, a bare name with no
dot at all (which can only exist on this network), every private and reserved
IPv4 range, and every private and reserved IPv6 range. It runs when the row is
written **and again at send time**, because a row can be older than the guard.
The request goes out with `redirect: 'manual'` — otherwise a public address
answers 302 and points at a private one — and an `AbortSignal` of five seconds.

**A channel secret is sealed with AES-256-GCM and bound to its channel.** The
channel id is the additional authenticated data, so a sealed secret copied into
another row does not open. The stored form is `v1.<nonce>.<ciphertext>` in hex,
and `alert_channels_a_secret_is_never_stored_in_the_clear` refuses anything that
does not look like that — a plaintext secret cannot reach the column by
accident. The secret that signs is **not** the key that opens the box, and a
test asserts the two produce different signatures.

**Webhooks are signed** with `X-NekoLog-Signature: sha256=<hmac>` over the exact
body sent, using a 32-byte per-channel secret the server mints.

The notice carries the rule name, the environment, the measured value, the
threshold, the window and a link to the Explorer with the search and the period
already filled in, in all three locales. A rule name is chosen by a person, so
the HTML part escapes it; a test feeds it `<script>`.

Threats **S5**, **I8** and **E7** move to implemented.

One correctness note found by its own test: `crypto.getRandomValues` loses its
receiver when it is pulled off `crypto`, so every seal threw `Value of "this"
must be of type Crypto` until it was called on the object rather than detached.
