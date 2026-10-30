export const SOURCE_LOCALE = { key: 'root', lang: 'en', label: 'English', dir: '' }

export const TRANSLATED_LOCALES = [
  { key: 'pt-br', lang: 'pt-BR', label: 'Português', dir: 'pt-br' },
  { key: 'es', lang: 'es', label: 'Español', dir: 'es' },
]

export const starlightLocales = {
  [SOURCE_LOCALE.key]: { label: SOURCE_LOCALE.label, lang: SOURCE_LOCALE.lang },
  ...Object.fromEntries(
    TRANSLATED_LOCALES.map((locale) => [locale.key, { label: locale.label, lang: locale.lang }]),
  ),
}
