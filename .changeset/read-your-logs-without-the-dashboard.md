---
"@nekolog-io/adapters": minor
"@nekolog-io/clickhouse": minor
---

Read the logs back without the dashboard.

`@nekolog-io/clickhouse/search` gains `logSearchQuery` and `logHistogramQuery`,
the two statements a reader needs beside the `searchWhere` that was already
there. The histogram's bucket comes from a closed list and is rendered as a
literal number of seconds, so a caller cannot put anything of their own next to
`INTERVAL`, and a period that would produce more than 1 500 points is refused
rather than run.

`@nekolog-io/adapters` gains `IssueReader` and `sqlIssueReader`: `IssueStore`
could only write. It joins `issue_environments`, so an issue is scoped to the
environment that actually saw it, and it pages by cursor on `(last_seen_at, id)`
rather than by offset.

**`queryRows` now asks ClickHouse to quote 64-bit integers, and that is a bug
fix.** A `UInt64` does not fit in a JavaScript number: a real fingerprint came
back from a running stack as `9798706835935588000` instead of
`9798706835935588174`, because the server answered with an unquoted number and
`JSON.parse` rounded it. Every reader in this repository is JavaScript, so the
safe shape is the default; a caller that genuinely wants a number — the usage
store counting events — passes `output_format_json_quote_64bit_integers: '0'`
itself, as it already did.
