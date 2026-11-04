# @apps/docs

Documentation site, built with [Starlight](https://starlight.astro.build/).

- `pnpm --filter @apps/docs dev` — local dev server
- `pnpm --filter @apps/docs build` — production build into `dist/`
- `pnpm --filter @apps/docs preview` — serve the built site

## Locales

English is the source language and lives at the root; the other locales get a
path prefix (see `docs/PLANO.md` section 13):

| Locale | Path | Content |
|---|---|---|
| English | `/docs/` | `src/content/docs/` |
| Português | `/docs/pt-br/` | `src/content/docs/pt-br/` |
| Español | `/docs/es/` | `src/content/docs/es/` |

The locale list lives in `locales.mjs`, which `astro.config.mjs` feeds to
Starlight and `tests/i18n-parity.test.ts` reads. Adding a locale there makes the
parity test immediately require translations for every existing page.

Starlight ships its own translations for the UI strings in all three locales.
`src/content/i18n/*.json` exists to override individual strings when needed —
the files are intentionally near-empty.

**Every page must exist in all three locales**, and `pnpm --filter @apps/docs
test` fails if one is missing (or if a translated page has no English source).
Without that check a missing translation silently falls back to English, which
is easy to miss in review.

## What else the tests check

Page parity is the weakest of the four checks, because it only counts files.
Three more run beside it, and each exists because a sabotage run showed the
suite could not tell the difference without it:

- **Every internal link resolves** (`tests/links.test.ts`). With roughly a
  hundred hand-written `/docs/…` links across 36 pages, a typo is the most
  likely defect here and nothing else catches one — Astro builds a dead link
  happily.
- **No page links out of its own locale.** A `/docs/guides/x/` link inside a
  `pt-br/` page drops the reader into English mid-sentence. This one also
  catches a page that was copied from the English source and never translated,
  since the copy brings the English links with it.
- **Every guide is linked from the quickstart of its own locale**, so a new
  guide cannot be added in one language and forgotten in the other two.
- **Every page appears in the sidebar, and every sidebar entry has a page**
  (`tests/guides.test.ts`). A slug with no page already fails the build; a page
  with no slug builds fine and is reachable only by typing the URL, which is
  what this half catches.
- **Every server guide tells the reader to allow `traceparent` in CORS**, in all
  three locales, and the tracing page names both `Access-Control-Allow-Headers`
  and `Access-Control-Expose-Headers`. That note is the point of step 3.15:
  without it the browser's `traceparent` turns a cross-origin call into a
  preflight the API refuses, and the integration simply does not work.

`tsconfig.scripts.json` covers the whole `tests/` directory (it needs
`allowJs` for `locales.mjs`), so a type error in a test is a failure rather
than something only vitest would find at runtime.

## No `astro check`

`astro check` does not support TypeScript 7, which this monorepo uses, and Astro
is deprecating it in favour of the experimental `@astrojs/ts-content-mapper`.
`astro build` already validates the content collection schemas, so it is the
gate that matters here. Do not add `astro check` back without first confirming
it works against the repo's TypeScript version. There **is** a `typecheck`
script, scoped by `tsconfig.scripts.json` to `scripts/` and to the header test —
TypeScript that nothing else would check.

## `vercel.json` is generated, not written

The site is static, so there is no per-request nonce: the same file goes to
everybody. Its CSP is therefore a list of **hashes**, one per inline script that
Starlight emits, and `scripts/headers-cli.ts` reads them out of `dist/` after
every build. `pnpm --filter @apps/docs build` runs the check and **fails** when
the committed file no longer covers what the build produced — an inline script
that no hash covers is a blank page in the browser, not a warning. Regenerate
with:

```bash
pnpm --filter @apps/docs headers:write
```

`style-src` carries `'unsafe-inline'` on purpose: Starlight writes hundreds of
`style="…"` attributes, which no hash and no nonce can reach. The generator
refuses to write a policy when a `<style>` **element** appears in `dist/`,
because a hash there would make the browser ignore `'unsafe-inline'` and break
every one of those attributes silently. `script-src` stays locked to `'self'`
plus the hashes. See [`@internal/security-headers`](../../internal/security-headers/README.md).
