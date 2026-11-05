# Security Policy

NekoLog receives data from third parties, stores credentials, and distributes
packages that run inside other people's applications. Security reports are
welcome and taken seriously.

This repository is private, so nobody outside can read this file. **The copy a
customer or a researcher actually reads belongs on the site**, and putting it
there is still to do. Until then, this is the policy and the address is live
once the domain is.

## Reporting a vulnerability

Email **security@nekolog.io**.

GitHub's private vulnerability reporting is not an option here: it is a feature
of public repositories, and a researcher cannot open an advisory against a
repository they cannot see.

Please include:

- a description of the vulnerability and its impact;
- steps to reproduce, or a proof of concept;
- the affected package, app or component, and its version.

### What to expect

- **Acknowledgement within 72 hours.**
- **A fuller response within 7 days**, with an assessment and a timeline.
- Updates while the fix is worked on, and a disclosure date agreed with you.
- Credit in the advisory and the release notes, with your permission.

## Supported versions

NekoLog is at **1.0.0** and nothing has been published to any registry, so
there is no released version in the wild to fix. From the first published
release, section 16 of [docs/PLANO.md](docs/PLANO.md) applies: the current
major receives everything, the previous major receives security fixes for six
months after a new one, and `/v1` of the HTTP API keeps answering for at least
six months after `/v2` exists.

## Scope

The platform: the `@nekolog-io/*` packages, the ingestion, the jobs, the public
read API, the site, the documentation and the infrastructure configuration. The
dashboard is in a separate private repository; report anything about it to the
same address and it will be routed.

Two things are worth knowing before reporting:

- **Nothing is published yet, and there is no publish token anywhere.** When
  publishing starts, how the packages are distributed decides what a leaked
  credential would be worth; today there is no credential to leak. Note that
  npm provenance is not available from a private repository, so a published
  tarball will not carry an attestation naming the commit that built it. Each
  release does carry a CycloneDX bill of materials.
- **[docs/security/threat-model.md](docs/security/threat-model.md) records what
  was accepted without full mitigation**, and why. If a finding is already
  there with a reason, say so — the reason may still be wrong, and that is
  worth hearing.
