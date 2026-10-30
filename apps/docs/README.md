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

Starlight ships its own translations for the UI strings in all three locales.
`src/content/i18n/*.json` exists to override individual strings when needed —
the files are intentionally near-empty.

**Every page must exist in all three locales.** A page that is missing a
translation falls back to English silently, which is easy to miss in review.

## No `typecheck` script

`astro check` does not support TypeScript 7, which this monorepo uses, and Astro
is deprecating it in favour of the experimental `@astrojs/ts-content-mapper`.
`astro build` already validates the content collection schemas, so it is the
gate that matters here. Do not add `astro check` back without first confirming
it works against the repo's TypeScript version.
