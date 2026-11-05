# @apps/jobs

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

- [#130](https://github.com/gabrielbarbosaa/nekolog-io/pull/130) [`9a50118`](https://github.com/gabrielbarbosaa/nekolog-io/commit/9a50118ae28173fb044a8840f2c3cd870728dd1d) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Give both Workers a deployment. Each one gains a `wrangler.json` with a `dev`, `qa` and `prod` environment, and `.github/workflows/deploy-workers.yml` compiles all six with `wrangler deploy --dry-run` on every pull request and publishes on merge, into a protected GitHub environment per branch.
  
  Because wrangler does not interpolate environment variables in its configuration, the committed file carries placeholders and the new `@internal/deploy` fills them in at deploy time. It writes a configuration holding only the environment being deployed, so an environment's values can never reach another one's Worker, and it fails naming every value that is missing or blank instead of publishing a Worker without a binding. Secrets are kept out of that path entirely: their names live in `deploy/workers/secrets.json`, `wrangler secret bulk` uploads them from a file the step deletes, and no value reaches a log or an error message.
  
  Neither Worker is reachable by a `workers.dev` address. The ingestion answers only on the hostnames the plan names, which are now `cloudflare_workers_custom_domain` resources in `infra/modules/environment`; the jobs Worker has no hostname at all and is woken only by its cron. The VM also gets the SSH path step 1.17 left open: a fourth tunnel and an Access application whose single policy is the operator addresses, with still no inbound rule on port 22.

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

- [#132](https://github.com/gabrielbarbosaa/nekolog-io/pull/132) [`a128738`](https://github.com/gabrielbarbosaa/nekolog-io/commit/a1287384af7a0d59f159639708dbcbdd34caf2bd) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add the per-environment rate limit, the per-project attribute budget and the daily quota block.
  
  Usage is now counted from a new `usage_per_minute` rollup grouped by `received_at` instead of
  `logs_per_minute`, which groups by the client-supplied `timestamp` — a quota built on the latter
  could be dodged by backdating events. The ingestion Worker's ClickHouse user needs
  `SELECT(received_at)` on `logs` before the migration applies.

- [#41](https://github.com/gabrielbarbosaa/nekolog-io/pull/41) [`eb8618a`](https://github.com/gabrielbarbosaa/nekolog-io/commit/eb8618a002e3f56531b32c2a765afeb0ea742a36) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Keep a batch ClickHouse refused, and replay it exactly once.
  
  The ingest Worker writes the already-mapped rows to the R2 `SPOOL` bucket when
  the insert fails, and still answers 202. `onError` now fires only when both
  ClickHouse and R2 failed, and the message carries both causes. The `SPOOL`
  binding is required: a deployment without it would quietly drop the durability
  promise (threat D6).
  
  `apps/jobs` registers its first task, `spool-resend`, every minute. It takes the
  oldest files first, inserts, and only then deletes — a failed delete just means
  the next tick resends, and the deduplication token makes that a no-op. It stops
  at the first error that could pass later, because if ClickHouse is down the
  other files will fail the same way, and it does not stop at an error that never
  will: a 400 means those bytes are permanently unacceptable, so that file goes to
  `quarantine/` instead of blocking the queue forever. Unreadable files, keys that
  are not spool keys, and batches older than the retention window are quarantined
  too.
  
  The deduplication token is now `<environmentId>:<batchId>` rather than the bare
  `batchId`. The id is chosen by the client and ClickHouse deduplicates per table
  partition, which every project shares, so an unscoped token let one tenant's
  batch suppress another's.
  
  New `@internal/spool` holds the format both sides use: a zero-padded timestamp
  key so listing the first N objects returns the oldest N, strict decoding, and
  batch-id validation on the way into a file name. New `BlobStore` implementations
  in `@nekolog-io/adapters` (memory and R2), and `BlobStore.list` now takes a limit
  so the sweep does not walk the whole bucket every minute.
  
  A task's returned object now reaches the run summary as `detail`, so the sweep
  can report what it did.

- [#40](https://github.com/gabrielbarbosaa/nekolog-io/pull/40) [`ae98821`](https://github.com/gabrielbarbosaa/nekolog-io/commit/ae98821868b168a23f00536d8fa56885d65377c0) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add the scheduled Worker: one cron per environment, every task behind it.
  
  Cloudflare allows five Cron Triggers per account and NekoLog has three
  environments, so one trigger per environment fires every minute and the
  dispatcher decides what is due. Due-ness is arithmetic over the scheduled time
  (`(minute - offset) % everyMinutes === 0`) rather than remembered state, because
  a Worker isolate does not survive between runs — a "last run" variable would
  work in dev and quietly misfire in production. `offsetMinutes` keeps two tasks
  of the same cadence off the same tick.
  
  A task that throws cannot stop the others, and one that hangs cannot hold the
  tick: each gets a deadline capped by the whole run's budget, and its
  `AbortSignal` is aborted when the deadline passes, so a `fetch` made with it is
  really cancelled. Tasks run in parallel because they are all I/O. The run never
  rejects; it produces one JSON summary line with what ran, what was skipped and
  what failed.
  
  `scheduled` throws after reporting the summary, so a run with failures shows red
  in Cloudflare's Cron Events instead of green with a sad log line.
  
  `/health` answers with the version and the number of registered tasks. There is
  no route that triggers a task, and a test fails if one is added. It deliberately
  does not report the last run: the isolate answering `/health` is rarely the one
  that ran the cron, so it would claim "never ran" while everything is fine.
  
  `startScheduler` runs the same dispatcher off Cloudflare, aligned to the clock
  minute, re-queued each tick instead of a drifting interval, and refusing to
  start a run while the previous one is still going.
  
  No task is registered yet: 1.11 and 1.12 add the first ones.

- [#143](https://github.com/gabrielbarbosaa/nekolog-io/pull/143) [`bf7a4e4`](https://github.com/gabrielbarbosaa/nekolog-io/commit/bf7a4e49626955b495e103d7874e3ea6db9b4689) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Watch the two things that fill up in silence, and tell an external monitor the jobs are alive. `capacity-watch` counts what is still parked in the R2 spool and reads `system.disks` every five minutes, alerting above 100 pending files or below 15% free — and alerting when it cannot read either one, because an unreadable spool is the state in which the platform is worst, not best. The scheduled run then pings `HEARTBEAT_URL` on success and `…/fail` on failure, so a dead cron and a broken task do not look the same to the monitor; a monitor that is down is logged and never fails the run. `apps/web` answers `/health` with its version.

- [#174](https://github.com/gabrielbarbosaa/nekolog-io/pull/174) [`0b076a0`](https://github.com/gabrielbarbosaa/nekolog-io/commit/0b076a0f0992391c04eeaa104cc5154db62f1cda) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Tell the operator when the platform itself is in trouble.
  
  The three signals this codebase already raised went only to the Worker log,
  where nobody is watching at three in the morning. They now also reach
  `OPS_DISCORD_WEBHOOK_URL`, through the same SSRF guard, `redirect: 'manual'`
  and five-second deadline as a tenant's own webhook in 5.2 — an operator channel
  is still an address somebody typed.
  
  The mapping is deliberate about severity. **"I cannot measure" is critical**,
  the same rule `quota-block` and `capacity-watch` already follow internally: a
  disk reading that failed is not a healthy disk. A batch replayed but **not
  deleted** is critical too, because the next run writes it again. A filling
  spool, a quarantined batch and a blocked environment are warnings. An
  environment let back in after a block raises nothing, and a spooled batch that
  replayed as intended raises nothing.
  
  Three refusals: the alert is **always written to the log**, whether or not it
  was delivered, so the channel failing does not lose the signal; the notifier
  **never throws back** into the task that raised it; and with no webhook
  configured it says so rather than failing silently.
  
  `OPS_DISCORD_WEBHOOK_URL` is registered as a Worker **secret**, not a var — it
  is a URL that anyone holding it can post to.

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

- [#178](https://github.com/gabrielbarbosaa/nekolog-io/pull/178) [`d4a1ade`](https://github.com/gabrielbarbosaa/nekolog-io/commit/d4a1adedcf8bb3b0d3cd9aa97c3222d1e5d3bacb) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Run the whole platform on one machine with one command.
  
  `deploy/self-host/` brings up ClickHouse, Postgres, the ingestion and the jobs
  behind a bootstrap container that applies every migration and mints the first
  project before anything else starts. `./up.sh` generates the secrets if there
  are none, because the alternative — a list of steps where one is skipped — is
  how a self-host ends with a blank password in production. The installation
  guide is in `apps/docs` in all three languages, and it says on its first screen
  that **the dashboard is not included**: it is closed-source and cloud-only.
  
  **The spool and the quota block list are files, not Postgres.** On Cloudflare
  they are R2 and Workers KV. Here `@internal/self-host`'s `fileBlobStore` and
  `fileKvNamespace` put them in two Docker volumes shared by the two containers —
  Postgres would have been the obvious choice and it is the wrong one, because
  the ingestion never depends on Postgres or Redis and the ingestion is exactly
  what writes one and reads the other. Both write through a `rename`, so a reader
  polling the spool cannot pick up half an envelope and quarantine a batch that
  was never broken, and a blob key is an allowlist of `[A-Za-z0-9][A-Za-z0-9._-]*`
  per segment, because half of a spool key is a `batchId` the client chose.
  
  **The self-host jobs container runs more than the Worker does.** A Worker
  cannot reach Postgres, so `alert-evaluate`, `alert-notify` and `issue-rollup`
  are wired here and not there. `DATABASE_URL`, `ENCRYPTION_KEY` and
  `NEKOLOG_CONSOLE_URL` are therefore required rather than optional: a jobs
  container that starts without them would silently not evaluate a single alert.
  
  **`pnpm seed sync-db` is new and it is not decoration.** The seed document is
  what the ingestion reads for keys, but `issues`, `alert_rules` and
  `alert_channels` all carry a foreign key to `projects` and `environments`. On
  the hosted service the dashboard writes those rows; here nothing would, and the
  first real error made the issue rollup fail with a foreign key violation —
  found by running the stack, not by reading it. The command writes the
  organization, the project, the environments and the **key hashes**, never a key.
  
  **The jobs ClickHouse user could not read `system.disks` anywhere**, so
  `capacity-watch` has been reporting "I cannot measure" — which is an alert, and
  correctly so — instead of watching the disk. The grant is added in all three
  users files and `grants.test.ts` now pins it, along with the fact that it is
  the only part of `system` any credential may read.
  
  Exports are deliberately **not** wired into the self-host jobs container: 4.12
  writes a CSV through ClickHouse into an S3 bucket, and reading one back needs
  credentials this stack does not ask for. Not wired beats wired and failing
  every minute, and both the guide and a test say so out loud.

### Patch Changes

- Updated dependencies [[`5d67dc0`](https://github.com/gabrielbarbosaa/nekolog-io/commit/5d67dc0318a0ba23ecbb554dc14292ea2cd8fa90), [`3e68c91`](https://github.com/gabrielbarbosaa/nekolog-io/commit/3e68c91097c28d0d97bd4d081b438f0f08147cb2), [`618747a`](https://github.com/gabrielbarbosaa/nekolog-io/commit/618747a8ac888a1eb35e64ee9505189404f3d8f8), [`d208afb`](https://github.com/gabrielbarbosaa/nekolog-io/commit/d208afbe1996141286ff133872841e5341621d1b), [`8f4f90a`](https://github.com/gabrielbarbosaa/nekolog-io/commit/8f4f90abe551c5a149f8fba913bb95483e45d28d), [`b602f0b`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b602f0b4c75810a70ab527c1a6b18501a2367e86), [`89acf84`](https://github.com/gabrielbarbosaa/nekolog-io/commit/89acf8414914d70de158d09c0cd03afc5574a305), [`0be573f`](https://github.com/gabrielbarbosaa/nekolog-io/commit/0be573f78ab92d86dd2af5c40ad833103063e87d), [`23264a8`](https://github.com/gabrielbarbosaa/nekolog-io/commit/23264a81e09a9449e5b8f1bd4f65f6c41a658b1f), [`30b6d0e`](https://github.com/gabrielbarbosaa/nekolog-io/commit/30b6d0e6976d67bc94fa166e49b2357d6cacba02), [`b13b20c`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b13b20c04481823623f81f356a8f7d754bb8b995), [`86b2503`](https://github.com/gabrielbarbosaa/nekolog-io/commit/86b2503df4369cab7e39ad25a399b05185d3802b), [`ae94827`](https://github.com/gabrielbarbosaa/nekolog-io/commit/ae9482719f1cfde887a387e7608e0d8fa6a652cb), [`2ab714b`](https://github.com/gabrielbarbosaa/nekolog-io/commit/2ab714b4f393f46e90dc50f5dff3f8ca3bc569c5), [`d820891`](https://github.com/gabrielbarbosaa/nekolog-io/commit/d8208913e2b35a86132d94fc6a816636141a3896), [`c95a2d5`](https://github.com/gabrielbarbosaa/nekolog-io/commit/c95a2d5b337048cadacb049d243bdb4bf04594f2), [`3d886b1`](https://github.com/gabrielbarbosaa/nekolog-io/commit/3d886b1df376eae7d24e06cfee29ba00d36b3bc5), [`72eaba5`](https://github.com/gabrielbarbosaa/nekolog-io/commit/72eaba5c6ab14a56fc4341ba77112970ad7ebbb5), [`b1f4a7d`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b1f4a7de5a67637bdde6b9b79335190d2f3c9b26), [`7985ce7`](https://github.com/gabrielbarbosaa/nekolog-io/commit/7985ce7c4683c6e7c7ed21d0b44a21d594d2b3c2), [`a128738`](https://github.com/gabrielbarbosaa/nekolog-io/commit/a1287384af7a0d59f159639708dbcbdd34caf2bd), [`d6029f2`](https://github.com/gabrielbarbosaa/nekolog-io/commit/d6029f290ed1faf4151d9356ba87c77b148710bc)]:
  - @nekolog-io/adapters@1.0.0
  - @nekolog-io/clickhouse@1.0.0
  - @internal/self-host@0.0.1
