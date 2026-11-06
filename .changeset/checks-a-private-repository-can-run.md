---
'@internal/release': patch
'@internal/infra': patch
---

CodeQL, `dependency-review` and the OpenSSF Scorecard are gone: a private
repository cannot upload SARIF or run dependency review without GitHub Advanced
Security, and the Scorecard measures an open project. The first two had been
failing on every pull request since the repository went private.

A `Supply chain` workflow replaces the dependency half with more reach than it
had: `pnpm audit` and a new `pnpm run licences:check` read the **whole**
dependency tree on every pull request, where `dependency-review` read only what
the pull request changed. The licence policy refuses the GPL and AGPL families
in any spelling rather than the six SPDX identifiers the old list named; a
choice (`MIT OR GPL-3.0`) passes and a conjunction (`MIT AND GPL-3.0`) does not.

`internal/infra/src/repo.test.ts` is new and fails if a required status check
names a job no workflow reports — which `infra/repo` had been doing for two
checks that could never run again — or if a workflow reaches for Advanced
Security once more.

Static analysis of the code itself has **no** replacement. That is written down
in `docs/security/README.md` instead of being left to memory.
