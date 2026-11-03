---
'@nekolog-io/browser': minor
'@nekolog-io/core': patch
---

Add `@nekolog-io/browser`: uncaught errors and rejected promises, a per-tab session, `setUser`, and the batch leaving by `sendBeacon` on `pagehide`. A secret key handed to a browser is refused rather than sent, because anyone reading the page would have it. The beacon cannot carry a header, which is the whole reason the public key travels in the URL on that one path and the body goes as `text/plain` — a JSON content type would ask for a preflight that never happens while the page is unloading. `page.url` drops the query string and the fragment by default, because that is where reset tokens and coupons live. The session is a UUID in `sessionStorage` that only comes back if it still looks like one, so a poisoned entry becomes a new session instead of an attribute. `TransportTuning` gained a `fetch`, which is the seam the browser transport sends through.
