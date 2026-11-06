---
'@apps/dashboard': patch
'@apps/web': patch
'@apps/docs': patch
---

The logo. `docs/brand/` is the source and the apps carry byte-identical copies,
the same arrangement the theme already uses, with a test that fails on either
side of the drift. Two marks — the dark cat for a light background, the light
cat for a dark one — swapped by CSS rather than by JavaScript, so the right one
is there on the first frame instead of after a flash. The tab icon is square
and carries its own background, because a transparent one disappears into a
dark tab bar and then into a light one.
