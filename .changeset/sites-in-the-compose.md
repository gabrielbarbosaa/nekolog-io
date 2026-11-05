---
"@apps/docs": patch
"@apps/web": patch
"@internal/self-host": patch
---

Run the landing page and the documentation on the machine too.

`web` is `apps/web` as a Next standalone server (299 MB) and `docs` is
`apps/docs` built to static files behind a Caddy of its own (89 MB). Neither
publishes a port; the proxy routes `/docs` and `/docs/*` straight to the
documentation container rather than through Next's rewrite, so each site answers
with its own Content Security Policy — a nonce for the landing page, a hash per
inline script for the documentation.

That hash policy only existed as `vercel.json`, which means nothing in a
container: the documentation would have shipped with no CSP at all. The same
generator now also writes a Caddy header block, inside the image, from the
`dist/` the build just produced.

Each site has its own `.dockerignore`, so a change to a server app does not
invalidate its layers and make every deploy rebuild Next and Astro.
