---
'@apps/web': patch
---

Serve `/docs` from the documentation project instead of from the site, and keep the site's proxy out of that path. The documentation is static and carries a hash-based policy of its own; letting the site's nonce policy overwrite it would block every Starlight script and leave a blank page with no build error. A test asks the production server for a `/docs` path and fails if a `content-security-policy` comes back.
