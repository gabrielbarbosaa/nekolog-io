---
'@internal/release': patch
---

The browser jobs run in `mcr.microsoft.com/playwright`, which already carries
the three browsers and every library they need. There is no `playwright install`
step at all, so apt never runs and the slow Ubuntu mirror stops being able to
fail a pull request.

Dropping `--with-deps` for chromium and firefox in the previous attempt fixed
two of three; webkit still needed apt, and apt still needed that mirror — it hit
the eight-minute ceiling again, this time on gstreamer and libav rather than on
fonts. Removing the step removes the class of failure.

`workflow.test.ts` pins the image tag to the Playwright version
`packages/browser` depends on, in both directions: a dependency bump without an
image bump fails, and so does the reverse.
