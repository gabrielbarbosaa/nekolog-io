---
'@internal/release': patch
---

The browser job decides the apt step per browser. `--with-deps` on chromium
adds nine **font** packages, 21.9 MB, from a mirror serving them at about
40 KB/s — that is what the four "hangs" of the last two days were, and it had
stopped being intermittent: chromium hit the eight-minute ceiling twice in a
row on the same commit.

Chromium and firefox launch with nothing from apt and now take about 47 seconds
each, against chromium's 8m48s. Webkit keeps `--with-deps`, because it really
is missing libraries on `ubuntu-26.04` — `libgtk-4`, gstreamer and flite among
them — and says so by refusing to launch, which is how that was measured rather
than guessed.

`workflow.test.ts` pins each browser's answer separately, so turning one off
cannot quietly turn off the other two.
