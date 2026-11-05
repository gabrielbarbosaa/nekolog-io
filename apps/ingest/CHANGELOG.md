# @apps/ingest

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

- [#38](https://github.com/gabrielbarbosaa/nekolog-io/pull/38) [`be5eb3f`](https://github.com/gabrielbarbosaa/nekolog-io/commit/be5eb3f96f89956db968ab2bc2f3ac20ec717c43) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Authenticate by API key, with origin allowlists and CORS.
  
  The key arrives in `Authorization: Bearer` from a back end, or in `?key=` from
  a browser, where `sendBeacon` cannot send headers. A secret key in the query is
  refused with `secret_key_in_url` before any lookup, so not even its hash is
  computed — a URL reaches proxy logs, history and referrers, so a secret that
  travelled there is already leaked.
  
  Lookup is by SHA-256 hash, never by the key itself. After the key: the
  `logs:write` scope, the quota block, then the origin.
  
  Origin allowlists apply to public keys only, since those are the ones visible
  in a site's source. With a list configured, a request without an `Origin` is
  refused — otherwise the list protects nothing, because whoever copies the key
  sends it from curl. The subdomain wildcard checks scheme and suffix properly:
  `https://*.example.com` does not accept `example.com`, `aexample.com`,
  `app.example.com.attacker.test` or plain `http`.
  
  Preflight answers 204 and echoes the asking origin, and decides nothing — the
  POST is still authenticated and checked. Credentials are never granted. Errors
  carry CORS headers too, so the browser SDK reads `invalid_key` instead of a
  network failure it would retry forever. `traceparent` and `tracestate` are
  allowed through.

- [#165](https://github.com/gabrielbarbosaa/nekolog-io/pull/165) [`89acf84`](https://github.com/gabrielbarbosaa/nekolog-io/commit/89acf8414914d70de158d09c0cd03afc5574a305) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Measure the sender's clock at the insert, and stop a wrong one from destroying
  the log.
  
  `logs` gains `clock_skew_ms Int64` (migration `0006`), written by the ingestion
  as `received_at - timestamp`: positive when the sender is behind, negative when
  it runs ahead. It is the column the dashboard's five-minute warning reads.
  
  Marking the row is not enough on its own, because the row may not survive. The
  table partitions by `toYYYYMMDD(timestamp)` and its `TTL` is
  `timestamp + retention_days`, and `timestamp` belongs to the client. A clock set
  further back than the retention makes ClickHouse **drop the row at the insert** —
  the partition appears with zero rows and nothing is reported. A clock set
  forward writes into a partition no period query reaches and whose `TTL` only
  expires after it, which is retention evasion (threat T10).
  
  So the stored `timestamp` is bounded to
  `[received_at - (retention_days - 1h), received_at + 5min]`. The hour of margin
  keeps a merge from eating the row moments later, the floor follows the
  environment's own retention rather than a fixed window, and the five minutes
  ahead leave ordinary NTP drift alone. A replay from the browser's offline queue,
  up to seven days old, is untouched on a thirty-day retention.
  
  `clock_skew_ms` always records the real distance, bound or not, so the original
  is exactly `received_at - clock_skew_ms` — which is why it is `Int64` and not
  `Int32`: a clock set to 2099 is 2.2e12 ms away, and an `Int32` of milliseconds
  stops at 24 days.
  
  `LOG_COLUMNS` carries the new column, and a test now rebuilds the list from the
  migrations — `CREATE TABLE` plus every later `ADD COLUMN` — so the closed list
  cannot drift from the table. The same parser replaced the one in the ingestion's
  row test, which only ever read `0001_create_logs.sql` and would have missed any
  column added afterwards.

- [#130](https://github.com/gabrielbarbosaa/nekolog-io/pull/130) [`9a50118`](https://github.com/gabrielbarbosaa/nekolog-io/commit/9a50118ae28173fb044a8840f2c3cd870728dd1d) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Give both Workers a deployment. Each one gains a `wrangler.json` with a `dev`, `qa` and `prod` environment, and `.github/workflows/deploy-workers.yml` compiles all six with `wrangler deploy --dry-run` on every pull request and publishes on merge, into a protected GitHub environment per branch.
  
  Because wrangler does not interpolate environment variables in its configuration, the committed file carries placeholders and the new `@internal/deploy` fills them in at deploy time. It writes a configuration holding only the environment being deployed, so an environment's values can never reach another one's Worker, and it fails naming every value that is missing or blank instead of publishing a Worker without a binding. Secrets are kept out of that path entirely: their names live in `deploy/workers/secrets.json`, `wrangler secret bulk` uploads them from a file the step deletes, and no value reaches a log or an error message.
  
  Neither Worker is reachable by a `workers.dev` address. The ingestion answers only on the hostnames the plan names, which are now `cloudflare_workers_custom_domain` resources in `infra/modules/environment`; the jobs Worker has no hostname at all and is woken only by its cron. The VM also gets the SSH path step 1.17 left open: a fourth tunnel and an Access application whose single policy is the operator addresses, with still no inbound rule on port 22.

- [#37](https://github.com/gabrielbarbosaa/nekolog-io/pull/37) [`8cded1e`](https://github.com/gabrielbarbosaa/nekolog-io/commit/8cded1e7fbc1fd107ff094ad7f7d14723866f483) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - First version of the ingestion API: `POST /v1/logs` and `GET /health` on Hono.
  
  Validates against the payload contract, keeps the valid events when some in the
  batch are not, and answers with the stable error codes. Authentication is
  resolved before the body is read, so an unauthenticated caller cannot make the
  server buffer half a megabyte.
  
  Three size ceilings guard the batch: the declared `Content-Length`, the body
  read itself, and the output of the gzip decompressor. The last one is the one
  that matters — a 2 KB gzip that expands to 4 MB clears the first two without
  effort. The read stops at the first byte past the limit rather than finishing
  the job of filling memory.
  
  `projectId` and `environmentId` come only from the key, never from the payload.
  
  `createIngestApp` requires an authenticator and a sink, so an app that accepts
  anyone or silently drops logs cannot be built. The key store lands in step 1.8
  and the ClickHouse writer in 1.9.

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

- [#127](https://github.com/gabrielbarbosaa/nekolog-io/pull/127) [`f3d46bc`](https://github.com/gabrielbarbosaa/nekolog-io/commit/f3d46bceb5b85418ab34e860108fde2d60977aaa) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add `examples/express`: an Express API that sends real logs through the ingestion into ClickHouse, which is the milestone M1 criterion. It carries the request context with `AsyncLocalStorage`, continues a W3C `traceparent` the caller sent without trusting its contents, writes one access line per request with the matched route rather than the path the caller chose, keeps internal error messages out of the response, and strips the fields this domain treats as personal before anything leaves the process.
  
  `@apps/ingest` gains a Node entry point, `pnpm --filter @apps/ingest serve`, plus the exported `startLocalIngest`. It is the same Hono application the Worker serves, with the keys read from the seed document instead of Workers KV and no spool, so the whole path can run locally without Cloudflare.

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

- [#183](https://github.com/gabrielbarbosaa/nekolog-io/pull/183) [`b8bf9ba`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b8bf9badfd7079c09966b87d8a5db172954c813c) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Make the ingestion fit the CPU budget it actually has.
  
  A Worker on the free plan gets ~10 ms of CPU per request. Measured on 2026-11-04
  (step 6.4), the biggest batch specification 1 allows — 500 events, 20% errors,
  gzipped, every redaction rule on — cost **10.8 ms**. It did not fit, and no test
  could see it, because k6 measures latency and the CPU limit hides behind network
  waits.
  
  Two changes came out of that.
  
  **The fingerprint is memoized per batch.** The 100 `crypto.subtle.digest` calls
  in that batch cost 1.2 ms, and in a burst — which is the shape an incident has —
  they are all the same error. `createFingerprinter()` keys a map on the exact text
  that gets hashed, so the same error is hashed once. The map lives for one batch
  and never globally: a long-lived isolate would otherwise keep one that only
  grows. The worst case, where every error is distinct, is unchanged.
  
  **The SDK's default batch is 200 events, not 500.** `DEFAULT_MAX_BATCH_EVENTS`
  is new in `@nekolog-io/core`; `MAX_EVENTS_PER_BATCH` is untouched, so the
  protocol limit and the server are the same as before and a caller can still ask
  for 500. What changed is that the default client no longer sends the worst case
  without anyone choosing it. 200 events cost about 2.1 ms.
  
  After both, the 500-event batch costs 9.1 ms. There is still no headroom at the
  maximum, deliberately: asking for 500 is asking for the limit.
  
  Redaction was **not** optimised, although it is the second biggest cost. Every
  plausible optimisation there is a heuristic that skips values, and a privacy
  control that quietly stops redacting is worse than one that over-redacts.
  
  `apps/ingest` gains `src/budget.test.ts`, which measures the worst legal batch
  and fails both on an absolute per-event ceiling and — machine-independently — if
  cost stops growing linearly with the batch.

- [#177](https://github.com/gabrielbarbosaa/nekolog-io/pull/177) [`1e46c67`](https://github.com/gabrielbarbosaa/nekolog-io/commit/1e46c67f865d089c3654286b65ec3e01dc456f16) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Accept OTLP/HTTP logs at `POST /v1/otlp/logs`.
  
  The body is translated into specification 1 **before anything else**, so an
  OTLP record goes through exactly the same validation, fingerprinting, minimum
  level, sampling and redaction as a native one. There is no second ingestion
  path to keep in step — a test sends the same error twice over OTLP and asserts
  both rows share one fingerprint.
  
  **The answer is `200` with `partialSuccess`, not `202`.** That is what the OTLP
  specification requires and what an exporter is built to read; answering with
  our own shape would make every collector treat a success as a failure. A record
  that cannot be read is counted in `rejectedLogRecords` instead of failing the
  whole request, which is the same rule as "an invalid event does not bring down
  the batch".
  
  **`timeUnixNano` is read with `BigInt`.** It has been larger than
  `Number.MAX_SAFE_INTEGER` since 2001, so reading it as a number silently loses
  milliseconds — and after 4.11 a timestamp that drifts is not a cosmetic
  problem, it decides which partition the row lands in.
  
  Severity follows the specification's four-wide bands and falls back to
  `severityText`, then to `info`; the service, release and runtime come from
  `service.name`, `service.version` and `telemetry.sdk.language`. An `AnyValue`
  is read to three levels deep and no further, because a deeply nested attribute
  is an easy way to spend a Worker's whole CPU budget.
  
  One thing OTLP cannot give us: **a batch id**. The protocol has no idempotency
  key, so the server mints one and a retried OTLP send writes twice. The native
  route avoids that by carrying its own; the specification now says so plainly
  rather than leaving it to be discovered.

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

- [#39](https://github.com/gabrielbarbosaa/nekolog-io/pull/39) [`3e353b5`](https://github.com/gabrielbarbosaa/nekolog-io/commit/3e353b5ab045a9db1d41d104b256b20007757b87) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Write accepted batches to ClickHouse, behind `waitUntil`.
  
  The 202 goes out as soon as the batch validates; the insert runs in the
  platform's `waitUntil`, which the app finds through the Hono context rather
  than being told about. Outside a Worker there is none, so the write is awaited
  instead. A failed write does not change the 202 — the batch was accepted, and
  the failure goes to `onError` and, from step 1.11, to the R2 spool.
  
  The server stamps `project_id`, `environment_id`, `received_at`, `country` and
  `retention_days`. No IP header is read anywhere on the path, only the country,
  validated as two characters. `fingerprint` stays 0 until step 4.5.
  
  An `error.message` that differs from the log message is kept as an attribute
  rather than dropped, since the table has no column for it.
  
  The columns a row writes are checked against the migration itself, so renaming
  a column without updating the mapping fails a test.
  
  `src/worker.ts` is the Cloudflare entry. `assertEnv` names every missing
  binding at once instead of letting the first request die on `undefined`.

### Patch Changes

- [#132](https://github.com/gabrielbarbosaa/nekolog-io/pull/132) [`a128738`](https://github.com/gabrielbarbosaa/nekolog-io/commit/a1287384af7a0d59f159639708dbcbdd34caf2bd) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Fuzz the ingestion validator, the body reader and the SDK-to-ingest contract with fast-check, and pin the limits of specification 1 to their documented values instead of only to each other.
  
  `internal/schema` relative imports now carry the `.ts` extension, like the rest of the repo.

- [#184](https://github.com/gabrielbarbosaa/nekolog-io/pull/184) [`df14e65`](https://github.com/gabrielbarbosaa/nekolog-io/commit/df14e65ecdb613844b357ea8cd1eab69f97707d4) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Refuse a query parameter the route does not have, and stop a browser sniffing an
  API answer.
  
  The security review of step 6.5 found that the public read API **ignored every
  query parameter it did not know**. `GET /v1/logs?period=7d` answered `200` with
  the default one-hour window, and the caller had no way to tell they had searched
  something other than what they asked for. The same held for
  `?project=prj_2` — harmless, because the scope has always come from the key, but
  indistinguishable from a request that worked.
  
  It is the same rule the search language already follows for `env:`: a filter that
  silently does nothing reads like a filter that works. So an unknown parameter is
  now a `400 invalid_query` naming it and naming the ones the route does take, and
  `params.test.ts` pins each route's list against the OpenAPI the API publishes, so
  the guard and the document cannot drift. `?key=` is still refused first, by the
  authenticator, with its own message.
  
  The OWASP ZAP scan of the same step found two missing headers. Both apps now
  send `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`, and the
  read API also sends `Cross-Origin-Resource-Policy: same-origin`, all from
  `@internal/security-headers` rather than a second source. `nosniff` is the one
  that matters: the read API returns log content, which is untrusted input, and a
  browser that sniffed that body as HTML would run it.
  
  The ingestion deliberately does **not** send `Cross-Origin-Resource-Policy`. Its
  body is `{"accepted":N}`, so there is nothing to protect from cross-origin
  embedding, and it is the only route with a browser client, whose `sendBeacon`
  flush happens during page unload and cannot be retried. The reason is written
  down in `docs/security/zap/ingest.conf`.
  
  Both header sets are tested on the refusals too — 400, 404, 429 and 503 — which
  is where a body is least expected.

- [#132](https://github.com/gabrielbarbosaa/nekolog-io/pull/132) [`a128738`](https://github.com/gabrielbarbosaa/nekolog-io/commit/a1287384af7a0d59f159639708dbcbdd34caf2bd) Thanks [@gabrielbarbosaa](https://github.com/gabrielbarbosaa)! - Add the seed command that creates an organization, a project, its environments and their API keys before the dashboard exists. The document it writes holds only key hashes, never a key in the clear; `add-key` is both the rotation path the plan asks for and the way back when a key is lost.
- Updated dependencies [[`5d67dc0`](https://github.com/gabrielbarbosaa/nekolog-io/commit/5d67dc0318a0ba23ecbb554dc14292ea2cd8fa90), [`3e68c91`](https://github.com/gabrielbarbosaa/nekolog-io/commit/3e68c91097c28d0d97bd4d081b438f0f08147cb2), [`618747a`](https://github.com/gabrielbarbosaa/nekolog-io/commit/618747a8ac888a1eb35e64ee9505189404f3d8f8), [`d208afb`](https://github.com/gabrielbarbosaa/nekolog-io/commit/d208afbe1996141286ff133872841e5341621d1b), [`8f4f90a`](https://github.com/gabrielbarbosaa/nekolog-io/commit/8f4f90abe551c5a149f8fba913bb95483e45d28d), [`b602f0b`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b602f0b4c75810a70ab527c1a6b18501a2367e86), [`89acf84`](https://github.com/gabrielbarbosaa/nekolog-io/commit/89acf8414914d70de158d09c0cd03afc5574a305), [`0be573f`](https://github.com/gabrielbarbosaa/nekolog-io/commit/0be573f78ab92d86dd2af5c40ad833103063e87d), [`23264a8`](https://github.com/gabrielbarbosaa/nekolog-io/commit/23264a81e09a9449e5b8f1bd4f65f6c41a658b1f), [`30b6d0e`](https://github.com/gabrielbarbosaa/nekolog-io/commit/30b6d0e6976d67bc94fa166e49b2357d6cacba02), [`b13b20c`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b13b20c04481823623f81f356a8f7d754bb8b995), [`a128738`](https://github.com/gabrielbarbosaa/nekolog-io/commit/a1287384af7a0d59f159639708dbcbdd34caf2bd), [`86b2503`](https://github.com/gabrielbarbosaa/nekolog-io/commit/86b2503df4369cab7e39ad25a399b05185d3802b), [`ae94827`](https://github.com/gabrielbarbosaa/nekolog-io/commit/ae9482719f1cfde887a387e7608e0d8fa6a652cb), [`2ab714b`](https://github.com/gabrielbarbosaa/nekolog-io/commit/2ab714b4f393f46e90dc50f5dff3f8ca3bc569c5), [`d820891`](https://github.com/gabrielbarbosaa/nekolog-io/commit/d8208913e2b35a86132d94fc6a816636141a3896), [`c95a2d5`](https://github.com/gabrielbarbosaa/nekolog-io/commit/c95a2d5b337048cadacb049d243bdb4bf04594f2), [`3d886b1`](https://github.com/gabrielbarbosaa/nekolog-io/commit/3d886b1df376eae7d24e06cfee29ba00d36b3bc5), [`72eaba5`](https://github.com/gabrielbarbosaa/nekolog-io/commit/72eaba5c6ab14a56fc4341ba77112970ad7ebbb5), [`51a02a4`](https://github.com/gabrielbarbosaa/nekolog-io/commit/51a02a4516c9ec5ed761437c654ba1a12a14e923), [`a128738`](https://github.com/gabrielbarbosaa/nekolog-io/commit/a1287384af7a0d59f159639708dbcbdd34caf2bd), [`b1f4a7d`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b1f4a7de5a67637bdde6b9b79335190d2f3c9b26), [`7985ce7`](https://github.com/gabrielbarbosaa/nekolog-io/commit/7985ce7c4683c6e7c7ed21d0b44a21d594d2b3c2), [`a128738`](https://github.com/gabrielbarbosaa/nekolog-io/commit/a1287384af7a0d59f159639708dbcbdd34caf2bd), [`d6029f2`](https://github.com/gabrielbarbosaa/nekolog-io/commit/d6029f290ed1faf4151d9356ba87c77b148710bc)]:
  - @nekolog-io/adapters@1.0.0
  - @nekolog-io/clickhouse@1.0.0
  - @internal/schema@0.0.1
  - @internal/security-headers@0.1.0
  - @internal/seed@0.1.0
  - @internal/self-host@0.0.1
