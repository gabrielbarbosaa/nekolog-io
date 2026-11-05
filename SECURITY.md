# Security Policy

NekoLog receives data from third parties, stores credentials, and publishes packages that run inside other people's applications. We take security issues seriously and appreciate responsible disclosure.

## Supported versions

NekoLog is at **1.0.0**, and nothing has been published to npm yet — there is no released version in the wild to fix. From the first published release the policy in [docs/PLANO.md](docs/PLANO.md) (section 16) applies: the current major receives everything, the previous major receives security fixes for six months after a new one, and `/v1` of the HTTP API keeps answering for at least six months after `/v2` exists. [Versioning and support](https://nekolog.io/docs/reference/versioning/) says the same thing for readers.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Use GitHub's [private vulnerability reporting](https://github.com/gabrielbarbosaa/nekolog-io/security/advisories/new) (Security tab → "Report a vulnerability") so the report stays confidential while we work on a fix.

If you'd rather not use GitHub, email **security@nekolog.io** (once the domain is live; until then, open a private advisory on GitHub).

Please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce, or a proof of concept.
- The affected package, app, or component and version.

### What to expect

- **Acknowledgment within 72 hours** of your report.
- **A more detailed response within 7 days**, including our assessment and an expected timeline for a fix.
- We'll keep you updated as we work on a fix and coordinate a disclosure date with you.
- With your permission, we'll credit you publicly in the advisory and release notes once the fix ships.

## Scope

This policy covers the NekoLog monorepo: the published `@nekolog-io/*` packages, the ingestion, jobs and public read API Workers, the landing page, the documentation site, and the infrastructure configuration in this repository. The dashboard is closed-source and lives in a separate repository; report anything about it here too, and it will be routed.

Two things are worth knowing before you report:

- **Packages are published by trusted publishing (OIDC).** There is no npm token in this repository or in its secrets, so "a leaked publish token" is not a class of finding here. Each tarball carries provenance naming the commit and the workflow that built it, and a CycloneDX bill of materials is attached to each release.
- **[docs/security/threat-model.md](docs/security/threat-model.md) records what was accepted without full mitigation**, and why. If your finding is already there with a reason, say so — the reason may still be wrong, and that is worth hearing.
