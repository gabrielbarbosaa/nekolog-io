---
'@nekolog-io/adapters': minor
'@nekolog-io/db': minor
'@apps/jobs': minor
---

Rotate a webhook secret without breaking whoever receives it, and rotate the
database key without destroying what it protects.

**The webhook secret overlaps.** `alert_channels` gains
`previous_sealed_secret` and `secret_rotated_at` (migration `0012`); while both
are set, `X-NekoLog-Signature` carries **two** signatures separated by a comma,
the current one first. A receiver checking either keeps working, which is the
same shape Stripe and GitHub use. There are never three: sending more than two
is refused, because a window that accumulates is a window nobody closes. Three
check constraints hold the rest — a previous secret must also be sealed, must
say when it was replaced, and must not be the current one.

**The database key can now be rotated at all.** `resealChannelSecrets` opens
every sealed secret with the old key and writes it back under the new one, in
pages, and moves a secret mid-rotation along with it. `docs/runbooks/rotacao-de-segredos.md`
recorded this as a real pending item — *"this script does not exist. It needs to
be written before M5, when alert channels start storing secrets. Rotating this
key today, without it, destroys data."* It exists now, and the runbook carries
the procedure.

Three things make it safe to run against production. A **dry run** opens
everything and writes nothing, so an old key that does not open some row is
found before anything is lost. Running it **twice is harmless**: a secret
already on the new key is recognised and left alone, which is what lets an
interrupted run be resumed. And each write only lands **if the row is still as
it was read**, so two runs cannot overwrite each other.

A secret it cannot open is reported, never destroyed, and the run carries on
with the next channel.
