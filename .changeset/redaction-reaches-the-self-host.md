---
"@apps/ingest": patch
"@internal/seed": patch
"@internal/self-host": patch
---

Carry the minimum level, the sample rate and server-side redaction into the
self-host.

All three are enforced at ingestion and ride on the key record, but the only
thing that produces a key record on one machine is the seed document, and the
seed document never carried them. The settings existed, the columns existed, and
nothing could reach them: a log could hold a card number in the clear with no way
to turn redaction on.

The document now carries them (version 2; a version 1 document still reads, with
the behaviour it had), `pnpm seed init` takes `--min-level`, `--sample-rate`,
`--redact` and `--redact-attributes`, `pnpm seed set` changes them afterwards,
and `sync-db` writes all three into Postgres so the dashboard will agree.

A project minted here starts with the personal-data patterns on — credit card,
CPF, CNPJ, e-mail, Brazilian phone, JWT and `Bearer`. UUID, IPv4 and IPv6 stay
off, because they are usually the thing being debugged.

The ingestion re-reads the seed file when its modification time changes, so a
change takes effect without a restart, and keeps the keys it has when the file is
briefly unreadable.
