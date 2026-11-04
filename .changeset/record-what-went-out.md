---
"@nekolog-io/adapters": minor
"@nekolog-io/cli": minor
---

Record what went out.

`@nekolog-io/cli` gains `nekolog releases create <version>`, with `--commit`,
`--at` and `--api`, reading the key from `--key` or `NEKOLOG_KEY`. It refuses
three things **before it opens a socket**, so a mistake never puts the key on
the wire: a public key (it ships in every browser bundle), a commit that is not
what `git rev-parse` prints, and plain HTTP to anywhere but this machine. The
command is idempotent, so a pipeline that reruns is harmless.

`@nekolog-io/adapters` gains `ReleaseStore` and `sqlReleaseStore`, which writes
the `releases` row that migration `0003` has been waiting for. Sending the same
version again returns the row that exists, keeps the earliest `releasedAt` and
never drops a commit it already knows — `least` and `coalesce`, the same rules
an issue's `first_seen_at` follows.

The Crockford id generator that `newIssueId` and `newAlertEventId` each carried
a copy of is now one `crockfordId` in `src/ids.ts`. A third copy for
`newReleaseId` was the moment to stop; both existing names and their behaviour
are unchanged.
