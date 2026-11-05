# @apps/api

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

### Patch Changes

- Updated dependencies [[`5d67dc0`](https://github.com/gabrielbarbosaa/nekolog-io/commit/5d67dc0318a0ba23ecbb554dc14292ea2cd8fa90), [`3e68c91`](https://github.com/gabrielbarbosaa/nekolog-io/commit/3e68c91097c28d0d97bd4d081b438f0f08147cb2), [`618747a`](https://github.com/gabrielbarbosaa/nekolog-io/commit/618747a8ac888a1eb35e64ee9505189404f3d8f8), [`d208afb`](https://github.com/gabrielbarbosaa/nekolog-io/commit/d208afbe1996141286ff133872841e5341621d1b), [`8f4f90a`](https://github.com/gabrielbarbosaa/nekolog-io/commit/8f4f90abe551c5a149f8fba913bb95483e45d28d), [`b602f0b`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b602f0b4c75810a70ab527c1a6b18501a2367e86), [`89acf84`](https://github.com/gabrielbarbosaa/nekolog-io/commit/89acf8414914d70de158d09c0cd03afc5574a305), [`0be573f`](https://github.com/gabrielbarbosaa/nekolog-io/commit/0be573f78ab92d86dd2af5c40ad833103063e87d), [`23264a8`](https://github.com/gabrielbarbosaa/nekolog-io/commit/23264a81e09a9449e5b8f1bd4f65f6c41a658b1f), [`30b6d0e`](https://github.com/gabrielbarbosaa/nekolog-io/commit/30b6d0e6976d67bc94fa166e49b2357d6cacba02), [`b13b20c`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b13b20c04481823623f81f356a8f7d754bb8b995), [`86b2503`](https://github.com/gabrielbarbosaa/nekolog-io/commit/86b2503df4369cab7e39ad25a399b05185d3802b), [`ae94827`](https://github.com/gabrielbarbosaa/nekolog-io/commit/ae9482719f1cfde887a387e7608e0d8fa6a652cb), [`2ab714b`](https://github.com/gabrielbarbosaa/nekolog-io/commit/2ab714b4f393f46e90dc50f5dff3f8ca3bc569c5), [`d820891`](https://github.com/gabrielbarbosaa/nekolog-io/commit/d8208913e2b35a86132d94fc6a816636141a3896), [`c95a2d5`](https://github.com/gabrielbarbosaa/nekolog-io/commit/c95a2d5b337048cadacb049d243bdb4bf04594f2), [`3d886b1`](https://github.com/gabrielbarbosaa/nekolog-io/commit/3d886b1df376eae7d24e06cfee29ba00d36b3bc5), [`72eaba5`](https://github.com/gabrielbarbosaa/nekolog-io/commit/72eaba5c6ab14a56fc4341ba77112970ad7ebbb5), [`51a02a4`](https://github.com/gabrielbarbosaa/nekolog-io/commit/51a02a4516c9ec5ed761437c654ba1a12a14e923), [`a128738`](https://github.com/gabrielbarbosaa/nekolog-io/commit/a1287384af7a0d59f159639708dbcbdd34caf2bd), [`b1f4a7d`](https://github.com/gabrielbarbosaa/nekolog-io/commit/b1f4a7de5a67637bdde6b9b79335190d2f3c9b26), [`7985ce7`](https://github.com/gabrielbarbosaa/nekolog-io/commit/7985ce7c4683c6e7c7ed21d0b44a21d594d2b3c2), [`a128738`](https://github.com/gabrielbarbosaa/nekolog-io/commit/a1287384af7a0d59f159639708dbcbdd34caf2bd), [`d6029f2`](https://github.com/gabrielbarbosaa/nekolog-io/commit/d6029f290ed1faf4151d9356ba87c77b148710bc)]:
  - @nekolog-io/adapters@1.0.0
  - @nekolog-io/clickhouse@1.0.0
  - @internal/security-headers@0.1.0
  - @internal/seed@0.1.0
  - @internal/self-host@0.0.1
