---
'@nekolog-io/adapters': patch
---

`@nekolog-io/adapters` relative imports now carry the `.ts` extension like the rest of the repo. Without it the package could only be loaded by a bundler, so the first command to import it under plain Node failed to resolve.
