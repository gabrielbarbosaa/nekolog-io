---
'@apps/web': patch
---

Serve `/docs` from the documentation project instead of from the site, and keep the site's proxy out of that path. The documentation is static and carries a hash-based policy of its own; letting the site's nonce policy overwrite it would block every Starlight script and leave a blank page with no build error. The guard reads the compiled matcher out of `functions-config-manifest.json` and fails if the proxy was built to run on a `/docs` path — an assertion against the running server could not tell the two configurations apart while the rewrite has nowhere to go.
