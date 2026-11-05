# @nekolog-io/adapters

## 1.0.0

### Major Changes

- Leave `0.x`.
  
  Nothing in this release breaks anything, because there is nothing to break: no
  version of any of these packages has ever been published. The major is what
  `0.x` means being over — from here the promises on
  [versioning and support](https://nekolog.io/docs/reference/versioning/) hold.
  A breaking change to the HTTP API becomes `/v2` and `/v1` keeps answering for at
  least six months; the ingestion accepts the two most recent `schemaVersion`
  values; anything being removed from a package gets a console warning and a
  changelog entry at least one minor before it goes.
  
  Two things changed in the code to make that a promise and not a sentence.
  
  **Every published package now ships a CycloneDX bill of materials**, written
  from the lockfile at release time and attached to that package's own GitHub
  Release. The documents list what the package brings, not what the application
  already has, and a check refuses a release where one is missing, left over from
  the version before, or describes something this release does not publish. Three
  of them — `core`, `cli` and `adapters` — promise **no runtime dependencies at
  all**, and that promise used to live only in prose; the bill of materials now
  answers it, so a transitive dependency arriving through a package they already
  use fails the release instead of shipping.
  
  **Publishing uses npm trusted publishing**, so there is no npm token in this
  repository or in GitHub to leak, and every tarball carries provenance naming the
  commit and the workflow that built it.
  
  `apps/api` and `apps/ingest` now answer `/health` with the version they were
  deployed as, the way `apps/jobs` already did — the plan has said the version
  shows at `/health` since the beginning, and on two of the three it did not.

### Minor Changes

- [#170](https://github.com/gabrielbarbosaa/nekolog-io/pull/170) [`5d67dc0`](https://github.com/gabrielbarbosaa/nekolog-io/commit/5d67dc0318a0ba23ecbb554dc14292ea2cd8fa90) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Deliver alerts to e-mail, Slack, Discord and signed webhooks.
  
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

- [#171](https://github.com/gabrielbarbosaa/nekolog-io/pull/171) [`3e68c91`](https://github.com/gabrielbarbosaa/nekolog-io/commit/3e68c91097c28d0d97bd4d081b438f0f08147cb2) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Keep the history of every alert, and hold back a notice that would repeat.
  
  `alert_events` (migration `0009`) records one row per state change, written in
  **the same statement** that moves the rule — a CTE that updates `alert_rules`
  and inserts the event together, so a run that dies between the two cannot
  exist. `on conflict (rule_id, at) do nothing` makes a replay harmless.
  
  The row carries what was measured, the threshold at the time, whether a notice
  went out, how many channels took it, and why it did not — `cooldown` or
  `no_channel`. Two check constraints keep that honest: a notice cannot be
  recorded as sent without a channel, and a suppressed event cannot also claim to
  have been sent.
  
  **The cooldown counts from the last firing notice that actually went out**, not
  from the last transition, and it holds back **only a firing notice**. The one
  that says the alert is over is never held: being told it broke and never told
  it was fixed is worse than one message too many. An alert held back is still
  recorded, so the screen can say why nobody was told.
  
  A rule whose cooldown holds it back is also stamped as notified, so it is not
  weighed again every minute until the window passes.
  
  The task prunes events older than ninety days, oldest first, at most five
  hundred per run — a history table with no end is a slow outage.
  
  Specification 6 carries a correction: the rule has **two** states and not
  three. "Resolved" is the return to `ok`, and that return is what sends the
  all-clear; a third enum value would be a state the rule never rests in.

- [#169](https://github.com/gabrielbarbosaa/nekolog-io/pull/169) [`618747a`](https://github.com/gabrielbarbosaa/nekolog-io/commit/618747a8ac888a1eb35e64ee9505189404f3d8f8) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Evaluate alert rules, all of an environment's in one query.
  
  Specification 6's five types are here: `threshold`, `error_rate`, `new_issue`,
  `issue_regression` and `absence`. `alert_rules` (migration `0007`) holds the
  condition as JSON; `parseAlertCondition` in `@nekolog-io/adapters` reads it, and
  both repositories use that one reader rather than two that can drift.
  
  **The free Worker allows 50 subrequests per run, so the query count is the
  design.** `@nekolog-io/clickhouse/alerts` compiles every measurable rule of one
  environment into a **single** statement: one `countIf` per rule, each carrying
  its own window and its own compiled search, over one scan bounded by the widest
  window. Twenty rules in an environment cost one ClickHouse call, not twenty.
  Each rule's search parameters are renamed `r<n>_p<m>`, so two rules in the same
  batch cannot collide — and the builder refuses rather than overwrite if they
  ever did.
  
  `new_issue` and `issue_regression` never touch ClickHouse at all: they count
  rows in `issues` that opened or regressed inside the window.
  
  **The condition no longer carries an environment, and the schema refuses one.**
  Specification 6's example had `"environment": "production"` inside the JSON.
  The environment is the `environment_id` column, which is half of the composite
  foreign key to `environments (id, project_id)` — the thing that stops a rule of
  one project pointing at another project's environment. A second copy inside the
  JSON would be a second truth no constraint can reach, so
  `alert_rules_condition_carries_no_environment` rejects it. The spec carries the
  correction.
  
  A rule's state lives on the rule (`ok`/`firing`, with `state_changed_at`), and
  the evaluator only writes when it *changes*, in one batched `UPDATE`. A rule
  that was disabled since it was read is never moved. `alert_events` and the
  cooldown are 5.3's, next to the code that writes them — 4.6's lesson again.
  
  Two refusals worth naming: a measurement that failed **never resolves** a firing
  rule, because "I could not measure" is not "it stopped"; and a stored condition
  that no longer parses throws instead of being evaluated as a guess.

- [#142](https://github.com/gabrielbarbosaa/nekolog-io/pull/142) [`0be573f`](https://github.com/gabrielbarbosaa/nekolog-io/commit/0be573f78ab92d86dd2af5c40ad833103063e87d) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Refuse to write to an address that already bounced, and check a bounce webhook before believing it. `suppressedMailer` asks a suppression list before every send and fails closed when it cannot tell — insisting on an address that hard bounced is the fastest way to lose the whole domain's reputation. `verifyWebhook` checks the provider's HMAC signature in constant time and refuses a missing header, a timestamp outside a five-minute tolerance, a timestamp from the future, and a signature that is only a prefix of the right one; without it, anyone who found the URL could suppress someone else's address and cut off their login. `email_suppressions` holds the list, lowercased and unique per address.

- [#172](https://github.com/gabrielbarbosaa/nekolog-io/pull/172) [`23264a8`](https://github.com/gabrielbarbosaa/nekolog-io/commit/23264a81e09a9449e5b8f1bd4f65f6c41a658b1f) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Enforce an environment's minimum level and sample rate at the ingestion.
  
  `environments` gains `min_level` and `sample_rate` (migration `0010`), both
  checked in the schema, and `KeyRecord` carries them so the Worker reads them
  from KV and never from Postgres. An event that does not pass never becomes a
  row — this cannot be a screen setting, because a screen cannot stop a write.
  
  **Sampling is deterministic, and seeded on the trace.** The seed is the
  `traceId`, falling back to the session id, falling back to the event's place in
  its batch. A whole trace is therefore kept or dropped together; sampling event
  by event would leave half a trace, which is no use to anybody investigating.
  The same event always gets the same answer, so a retried batch does not change
  its mind.
  
  **`error` and `fatal` are never sampled out**, whatever the rate. Losing an
  error to sampling is exactly what nobody wants, and a rate set low to control
  volume should cut the noise, not the signal.
  
  The level cut runs before the sample, so a quiet event is reported as
  `below_min_level` and never as `sampled_out`. A setting that makes no sense — a
  level nobody defines, a rate of zero or above one, `NaN` — falls back to letting
  everything through rather than silently dropping a tenant's logs.

- [#166](https://github.com/gabrielbarbosaa/nekolog-io/pull/166) [`30b6d0e`](https://github.com/gabrielbarbosaa/nekolog-io/commit/30b6d0e6976d67bc94fa166e49b2357d6cacba02) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Generate exports in ClickHouse and write them straight to the object store.
  
  `@nekolog-io/clickhouse/export` is a sixth entry point. `compileExport` builds
  an `INSERT INTO FUNCTION s3(...) SELECT ... FROM logs WHERE ...` in JSON
  (NDJSON), XML or CSV, gzipped, scoped by the same `searchWhere` the Explorer
  uses, so the project, the environment, the period and the reader's filter are
  all bound parameters and none of them is ever interpolated.
  
  **The CSV guard covers every text column, and the classification is the test.**
  A cell beginning `=`, `+`, `-`, `@`, a tab or a CR is prefixed with a quote, so
  a logged `=cmd|/c calc` opens as text rather than running. Rather than listing
  the columns to guard, the module splits the whole table into text and non-text
  and a test asserts the two lists together are exactly `LOG_COLUMNS` — a column
  added later cannot slip through unguarded. JSON and XML are left alone, where a
  leading equals sign means nothing and prefixing would corrupt the value.
  
  **Three things the dev ClickHouse had to be asked rather than assumed.** A
  write needs `s3_truncate_on_insert = 1`, because the existence check ClickHouse
  does otherwise fails against an S3 that is not AWS — and truncating is right
  anyway, since a retry must overwrite its own object rather than fail. An export
  that matches no rows writes **no object at all**, so the jobs task places a
  twenty-byte empty gzip itself; `ready` has to mean there is something to
  download, which is what the `exports_ready_means_there_is_an_object` constraint
  promises. And the credentials travel inside the statement: ClickHouse masks the
  secret in `query_log` as `[HIDDEN]`, but it does not mask error text, so the
  task strips the key and the secret from anything it writes into `failure`.
  
  `ExportStore` lands in `@nekolog-io/adapters` with a memory and a SQL
  implementation. The claim is a single `UPDATE ... FOR UPDATE SKIP LOCKED`, so
  two runs never take the same export, and it also takes back an export whose run
  plainly died — which needed a new `started_at` column (migration `0005`) and a
  `exports_running_means_it_started` check, because without it a Worker that died
  mid-export left the row `running` for ever and the reader got neither a file
  nor an error.
  
  The `nekolog_jobs` ClickHouse user gains `WRITE ON S3` and
  `CREATE TEMPORARY TABLE` — the second because a table function does not exist
  without it — and deliberately **not** `READ ON S3`: it can write an export and
  cannot read any object back into the database. `grants.test.ts` pins both
  halves.
  
  `infra/modules/r2-buckets` gains the `nekolog-exports-<env>` bucket with a
  seven-day lifecycle rule, which is what actually deletes the files; the jobs
  task marks the rows `expired` and deletes the objects it can, and the bucket
  rule is the backstop for the ones it cannot.

- [#167](https://github.com/gabrielbarbosaa/nekolog-io/pull/167) [`b13b20c`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b13b20c04481823623f81f356a8f7d754bb8b995) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Run exports on a schedule, and tell the reader when one is ready.
  
  `export-schedule` wakes every minute, works out which period has just closed
  and queues an export for every live schedule that has not had that period yet.
  The period is always the one that **finished**: the previous UTC day, or the
  previous Monday-to-Monday week. It waits fifteen minutes past the boundary so
  logs that arrived late still land inside it.
  
  Due-ness is `coalesce(last_run_at, created_at) < boundary`, which gives two
  things in one expression: a schedule that already ran for this period is
  skipped, and a schedule created *after* a period closed does not export a
  period it did not exist for.
  
  The queue is one statement — a CTE that re-checks the schedule is still live
  and still due under `FOR UPDATE SKIP LOCKED`, stamps `last_run_at` and inserts
  the `exports` row together. Two job runs racing cannot produce two exports of
  the same period, and a run that dies cannot stamp a schedule without queueing
  anything.
  
  `export-notify` then sends the notice, in the reader's own locale, with a link
  and never the file. `exports.notified_at` (migration `0006`) makes the notice
  once-only, and `exports_notice_follows_the_file` refuses to record a notice for
  an export with no object. The query joins `users` and skips anyone suspended or
  unverified.
  
  **The e-mail carries no text anybody typed** — not the export's filter, not the
  environment name. Only the period, the row count, the size, the expiry and the
  link, all server-derived. That is deliberate: it is what makes the HTML safe
  without having to trust escaping inside an e-mail client. The link itself is
  built only from an `https` base and an id matching the `exp_` shape, and both
  are refused otherwise.

- [#42](https://github.com/gabrielbarbosaa/nekolog-io/pull/42) [`86b2503`](https://github.com/gabrielbarbosaa/nekolog-io/commit/86b2503df4369cab7e39ad25a399b05185d3802b) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add the `RateLimiter` and `QuotaStore` adapters behind the per-environment rate limit and the daily quota block, and the `usage_per_minute` rollup they read.
  
  Usage is counted from `usage_per_minute`, grouped by `received_at`, instead of `logs_per_minute`, which groups by the client-supplied `timestamp` — a quota built on the latter could be dodged by backdating events. The ingestion Worker's ClickHouse user needs `SELECT(received_at)` on `logs` before the migration applies.

- [#164](https://github.com/gabrielbarbosaa/nekolog-io/pull/164) [`ae94827`](https://github.com/gabrielbarbosaa/nekolog-io/commit/ae9482719f1cfde887a387e7608e0d8fa6a652cb) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add the pieces an issue is made of. `@nekolog-io/adapters` gains the `IssueStore` contract with a memory implementation and `sqlIssueStore`, which takes an injected query runner rather than a driver, the way the Redis adapters take a client — so the package still has no runtime dependency. `@nekolog-io/clickhouse/issues` groups error rows by project, environment and fingerprint. `@nekolog-io/db` gains `issues` and `issue_environments`, because specification 5 says an issue is a project plus a fingerprint, counted per environment.
  
  Three rules live in the store rather than in whatever calls it. First seen never moves forward and last seen never moves backward, however out of order the occurrences arrive. An issue that was **resolved** and then happens again is reopened and stamped `regressed_at` — but only when the occurrence is newer than the fix, so a late batch from before the fix does not undo it. An issue somebody chose to **ignore** is never reopened, which is what ignoring means.
  
  The rollup windows by `received_at`, never by the `timestamp` the client chose, for the same reason `usage_per_minute` does: a sender that backdates its events would otherwise fall outside every window and never be grouped. The fingerprint travels as text the whole way — a `UInt64` does not fit in a JavaScript number, and `18446744073709551615` has to survive ClickHouse, the store and the Postgres column unchanged.

- [#135](https://github.com/gabrielbarbosaa/nekolog-io/pull/135) [`2ab714b`](https://github.com/gabrielbarbosaa/nekolog-io/commit/2ab714b4f393f46e90dc50f5dff3f8ca3bc569c5) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Implement `Mailer` for the cloud and for self-host: `resendMailer` posts to Resend's API with nothing but `fetch`, and `smtpMailer` takes a nodemailer-shaped transport the caller injects, which is also how the dev stack's Mailpit is reached.
  
  Every message is checked before it leaves, in both implementations and before the network call rather than after. A carriage return or newline in the recipient or the subject forges a header — it is how an unseen `bcc:` gets added — so it is refused; the address is lowercased and has to be a single address, with display names, commas and angle brackets rejected.
  
  `allowlistedMailer` enforces `EMAIL_ALLOWLIST` in dev and qa, and **an empty list allows nobody**. A missing variable is the likeliest state of a fresh machine, and the safe reading there is to write to no strangers at all. Entries match an address exactly or a whole domain through its leading `@`, so neither a `+tag` nor a longer lookalike domain slips through.
  
  The integration tests deliver through a real SMTP server and read the message back from Mailpit's API, including a check that a smuggled second recipient never arrives.

- [#179](https://github.com/gabrielbarbosaa/nekolog-io/pull/179) [`d820891`](https://github.com/gabrielbarbosaa/nekolog-io/commit/d8208913e2b35a86132d94fc6a816636141a3896) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Read the logs back without the dashboard.
  
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

- [#180](https://github.com/gabrielbarbosaa/nekolog-io/pull/180) [`c95a2d5`](https://github.com/gabrielbarbosaa/nekolog-io/commit/c95a2d5b337048cadacb049d243bdb4bf04594f2) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Record what went out.
  
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

- [#134](https://github.com/gabrielbarbosaa/nekolog-io/pull/134) [`3d886b1`](https://github.com/gabrielbarbosaa/nekolog-io/commit/3d886b1df376eae7d24e06cfee29ba00d36b3bc5) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Implement `RedisClient` twice without taking a dependency on either vendor: `upstashRedis` speaks the REST API, so it runs in a Worker with nothing but `fetch`, and `nodeRedis` takes an ioredis-shaped client the caller injects, the way `kvKeyStore` takes a KV binding.
  
  Scripts run by hash. Both implementations keep the SHA from `SCRIPT LOAD` and call `EVALSHA` afterwards, falling back to sending the text once when the server answers `NOSCRIPT` — which happens after a restart or a failover. Upstash's free tier counts commands, and the one-time-code script is dozens of lines that would otherwise travel on every login. An error that is not `NOSCRIPT` is rethrown, because a replica's `READONLY` must not turn into "send the script again".
  
  `prefixedRedis` namespaces every key by environment, including the `KEYS` an `eval` receives but not its `ARGV`: an argument is data, not an address. Without that, `dev` and `prod` sharing one Upstash would read each other's sessions.
  
  The integration tests run the one-time-code scripts from the plan against a real Redis and check, through `INFO commandstats`, that the second call never resends the script.

- [#175](https://github.com/gabrielbarbosaa/nekolog-io/pull/175) [`72eaba5`](https://github.com/gabrielbarbosaa/nekolog-io/commit/72eaba5c6ab14a56fc4341ba77112970ad7ebbb5) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Rotate a webhook secret without breaking whoever receives it, and rotate the
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

- [#173](https://github.com/gabrielbarbosaa/nekolog-io/pull/173) [`7985ce7`](https://github.com/gabrielbarbosaa/nekolog-io/commit/7985ce7c4683c6e7c7ed21d0b44a21d594d2b3c2) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Remove what an environment asked to remove, at the ingestion.
  
  `environments.redaction_rules` (migration `0011`) lets an environment turn on
  named patterns — e-mail, IPv4, IPv6, Brazilian phone, CPF, CNPJ, JWT, `Bearer`,
  UUID, credit card — and blank attributes by exact key or by prefix. The rules
  ride on the `KeyRecord` into KV and run in the Worker **before the write**, so
  what the tenant asked to remove never becomes a row.
  
  **The tenant does not write a regular expression, and that is the point.** The
  column accepts only names from a closed list, and a check constraint refuses a
  key called `regex`, `pattern` or `patternSource`. A third party's regex on the
  hot path of a Worker with a 10 ms CPU budget is denial of service the user
  writes for you — and this codebase has already been bitten twice by an
  accidentally quadratic pattern of its own.
  
  Which is exactly what happened again while writing this: the first e-mail
  pattern took **266 ms** over 16 KB of `1-1-1-…`, because `[A-Za-z0-9._%+-]+@`
  backtracks the whole run from every start position. Bounding the local part to
  64 characters — which is what RFC 5321 allows anyway — took it to **9.2 ms**,
  and all ten patterns together now cost **5.8 ms** on the worst shape measured.
  A test pins that budget.
  
  **A stored rule that cannot be read fails closed**: the ingestion applies every
  pattern it knows rather than none. A privacy control that quietly stops working
  is worse than one that over-redacts, and a broken rule is a configuration error,
  not a reason to write personal data in the clear.

- [#132](https://github.com/gabrielbarbosaa/nekolog-io/pull/132) [`a128738`](https://github.com/gabrielbarbosaa/nekolog-io/commit/a1287384af7a0d59f159639708dbcbdd34caf2bd) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Publish the packages both NekoLog repositories need. `internal/adapters`, `internal/clickhouse` and `internal/config` move to `packages/` and become `@nekolog-io/adapters`, `@nekolog-io/clickhouse` and `@nekolog-io/config`, built with tsdown and checked with publint and are-the-types-wrong, so the closed-source dashboard can depend on them instead of carrying a copy.
  
  Inside this repository they still resolve to their TypeScript source. `exports` points at `src/` and the `dist/` mapping lives under `publishConfig`, which pnpm applies when packing, so the migration runner, the seed script and the local ingestion keep running `.ts` directly with no build step.
  
  `@nekolog-io/clickhouse` ships its migrations and a `nekolog-clickhouse` binary, which makes the forward-only runner installable rather than only reachable by cloning the repository. The three are ESM only: their consumers are Node 24, Workers and Next, and the migration runner locates its SQL through `import.meta.url`, which has no honest CommonJS equivalent.
  
  `@nekolog-io/config` now annotates each environment schema explicitly and states its output type by hand rather than inferring it, because TypeScript 7 emits declarations through Oxc and Oxc cannot infer a Valibot expression. The environment contract of each app is now a readable type instead of an inferred one.

- [#181](https://github.com/gabrielbarbosaa/nekolog-io/pull/181) [`d6029f2`](https://github.com/gabrielbarbosaa/nekolog-io/commit/d6029f290ed1faf4151d9356ba87c77b148710bc) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Upload the maps.
  
  `@nekolog-io/cli` gains `nekolog sourcemaps upload <version> --dir dist`. It
  walks the build, takes every `.map`, flattens a nested path into one safe name,
  skips `node_modules` and dotted folders, and posts each file. The same three
  refusals as `releases create` happen before it opens a socket, and a map over
  the limit is skipped and named rather than silently dropped.
  
  `@nekolog-io/adapters` gains `SourceMapStore`, `blobSourceMapStore` and the
  validation beside it. **The store is built on `BlobStore`**, so the same code
  writes to an R2 bucket on Cloudflare and to a directory in a self-host: the
  application receives the bytes itself, which is why this works where exports
  could not. The key is `sourcemaps/<projectId>/<releaseId>/<name>` — the release
  **id**, never the version, because a version may legally hold a slash and an id
  is Crockford by construction.
  
  **The body is checked, not parsed.** The first 4 KB must open a JSON object and
  name `mappings` or `sections`, and a declared `version` must be 3. Parsing
  megabytes of JSON does not fit a Worker's CPU budget, and the map is parsed
  where it is used.
  
  `ReleaseStore` gains `byVersion` and `countSourceMaps`, so an upload can only
  land against a release that exists and the count on it stays true.

### Patch Changes

- [#124](https://github.com/gabrielbarbosaa/nekolog-io/pull/124) [`b1f4a7d`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b1f4a7de5a67637bdde6b9b79335190d2f3c9b26) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - `@nekolog-io/adapters` relative imports now carry the `.ts` extension like the rest of the repo. Without it the package could only be loaded by a bundler, so the first command to import it under plain Node failed to resolve.
