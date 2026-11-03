---
'@nekolog-io/browser': patch
---

`createLogger` now takes the `fetch` from `transport.fetch` as well as from the top-level `fetch` option. It used to build its own sender and silently throw away a `transport.fetch` the caller passed — which is the shape every other SDK in this repo accepts, so passing it and getting nothing was a trap. The compatibility smoke test walked straight into it.
