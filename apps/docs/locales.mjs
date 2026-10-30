// Single source of truth for the documentation locales: astro.config.mjs feeds
// this straight to Starlight, and the i18n parity test reads it to know which
// translations every page is required to have. Adding a locale here makes the
// parity test start demanding it.
//
// `dir` is the folder under src/content/docs/. The source locale uses Starlight's
// "root" key, meaning it has no path prefix and no folder of its own.
export const SOURCE_LOCALE = { key: 'root', lang: 'en', label: 'English', dir: '' }

export const TRANSLATED_LOCALES = [
  { key: 'pt-br', lang: 'pt-BR', label: 'Português', dir: 'pt-br' },
  { key: 'es', lang: 'es', label: 'Español', dir: 'es' },
]

/** Shape Starlight expects for its `locales` option. */
export const starlightLocales = {
  [SOURCE_LOCALE.key]: { label: SOURCE_LOCALE.label, lang: SOURCE_LOCALE.lang },
  ...Object.fromEntries(
    TRANSLATED_LOCALES.map((locale) => [locale.key, { label: locale.label, lang: locale.lang }]),
  ),
}
