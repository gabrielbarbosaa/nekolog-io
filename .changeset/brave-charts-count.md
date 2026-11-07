---
'@apps/dashboard': minor
---

The volume chart above the explorer: lines per slice of the period, stacked by
level, narrowing with the same search as the table below it.

Its theme is built from the stylesheet's own tokens, read at runtime so it
follows light and dark. ECharts cannot do colour maths on `oklch()`, so the
tokens are converted to sRGB in code, and the hex values recorded beside each
token in `globals.css` are what that conversion is tested against.

Accessibility is part of the chart rather than beside it: textures as well as
colour, a legend, a description for a screen reader, and the same numbers as a
real table behind a button.

The width of a bar is chosen by the server from the period and is not a
parameter: a one-minute bucket over a month is 43 200 bars.
