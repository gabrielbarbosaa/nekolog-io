---
'@apps/dashboard': patch
'@apps/web': patch
'@internal/release': patch
---

`apps/dashboard` exists: Next.js 16 with the Grafite theme, three languages from
the `NEKOLOG_LOCALE` cookie, a content security policy with a nonce per
response, and `/health`. The home page is the frame plus an honest note about
what is still missing; it leaves in 2.17.

Five design rules came out of running the `frontend-design` skill against the
2.1 mockups, and they are in the app's README because three of them correct
things the mockups got wrong: colour means a level or an environment, mono means
alignment and never a label, a border is a boundary and not a group, the query
is one object, and density is a resource.

`lib/utils.ts` extends tailwind-merge with the four custom font sizes. Without
it, `text-aside` is read as a colour and silently deletes `text-muted-foreground`
— the locale switcher's active label rendered as a blank white button and no
test could see it. `lib/utils.test.ts` now fails in both directions.

The theme test in `apps/web` covers the dashboard's stylesheet too, so there is
still one source for the palette.
