---
'@apps/web': patch
---

`docs/ui-mockups/` holds the first drawing of the dashboard: login and code,
Explorer, issues, keys, the first-log walkthrough and the five states every
screen has to have. Plain HTML and CSS, no build and no network, in the Grafite
theme with light and dark.

`apps/web/tests/theme.test.ts` is new and pins every copy of the palette to
`docs/tema/globals.css`. `CLAUDE.md` had asked for that in prose since October
and nothing enforced it, so a copy could drift in either direction without a
test noticing.
