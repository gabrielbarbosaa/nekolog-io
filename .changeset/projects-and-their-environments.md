---
'@apps/dashboard': minor
'@internal/auth': minor
---

Projects and environments, with the settings of each one. A project is born with
`production`, `staging` and `development` in a single statement; an environment
carries its colour, retention, minimum level, sample rate, daily quota, origin
allowlist and redaction rules. Every statement reaches an environment through its
project and its organization, so an id alone never crosses a tenant, and no
project is ever left without an environment to hold a key.
