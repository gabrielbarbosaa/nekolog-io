---
'@nekolog-io/adapters': patch
'@nekolog-io/clickhouse': patch
'@nekolog-io/config': patch
'@nekolog-io/db': patch
'@internal/release': patch
'@apps/web': patch
---

The two-repository split is over — ADR 0019. The dashboard comes here as
`apps/dashboard`, and `adapters`, `clickhouse`, `config` and `db` become
`private: true`: they were published only because the dashboard lived
elsewhere, and `@nekolog-io/db` published its TypeScript source as its types,
which is the whole Postgres schema. Nothing was ever published to npm and the
other repository is empty, so there is nothing to unwind.

The four lose `publishConfig`, `files`, `build` and `lint`, all of which existed
only to produce and check a tarball. Thirteen packages still go to npm: the
twelve SDKs and `@nekolog-io/core`.

The `@nekolog-io/*` scope therefore stops meaning "goes to npm", which the SBOM
command used as its filter. `SBOM_EXCLUDED` names the four and
`workspace.test.ts` ties that list to the private set in both directions, so
neither can drift. `packaging.test.ts` replaces the tests that described
publishing them with the ones that matter now, including that no published
package may depend on any of the four.
