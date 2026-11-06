---
'@apps/dashboard': patch
'@apps/ingest': minor
'@apps/jobs': patch
'@internal/seed': minor
---

`pnpm dev` now brings the whole stack up on a fresh machine: it writes a usable
`.env` (generating a real Ed25519 signing key, among other things), starts the
containers, waits for them, applies both sets of migrations and runs every app,
the ingestion, the jobs and the read API included. `pnpm dev:doctor` says what
is missing when something does not answer, and `pnpm seed invite` opens the
first account, which a fresh database otherwise has no way to create.

Five things were stopping it, each of which also affects a real deployment:
`APP_URL` pointed at the landing page rather than the dashboard, so every write
was refused; the shipped signing key was not a key; Turnstile was switched on
with nothing to render its widget; an empty `EMAIL_ALLOWLIST` meant no
confirmation code was ever sent; and a relative `KV_DIR` resolved against each
app's own directory, so the jobs published keys where the ingestion was not
looking. The local ingestion also now reads the KV, so a key minted in the
dashboard works there as it does in the self-host.
