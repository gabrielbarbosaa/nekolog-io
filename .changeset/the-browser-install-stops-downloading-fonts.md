---
'@internal/release': patch
---

The browser job installs the browser without `--with-deps`. On the
`ubuntu-26.04` runner every library Playwright asks for is already the newest
version — the webkit job proves it, installing nothing and finishing in 71
seconds — while chromium's dependency list adds nine **font** packages, 21.9 MB,
from a mirror serving them at about 40 KB/s. That is what the four "hangs" of
the last two days were, and it had stopped being intermittent: chromium failed
the eight-minute ceiling twice in a row.

Glyph rendering is not what these tests assert. If a future runner image does
drop a library, the browser fails to launch and Playwright names it, which is
loud rather than silent.
