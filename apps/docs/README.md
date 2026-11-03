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
