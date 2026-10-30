# Security Policy

NekoLog receives data from third parties, stores credentials, and publishes packages that run inside other people's applications. We take security issues seriously and appreciate responsible disclosure.

## Supported versions

NekoLog is pre-1.0 and under active development. Only the latest published version of each package and app receives security fixes until the 1.0 release. See [docs/PLANO.md](docs/PLANO.md) (section 16) for the versioning and support policy that will apply from 1.0 onward.

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

This policy covers the NekoLog monorepo: the published `@nekolog-io/*` packages, the ingestion and jobs Workers, the dashboard, and the infrastructure configuration in this repository.
