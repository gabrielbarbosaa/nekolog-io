export const locales = ['en', 'pt-BR', 'es'] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = 'en'
export const LOCALE_COOKIE = 'NEKOLOG_LOCALE'

export function matchLocale(tag: string): Locale | undefined {
  const normalized = tag.trim().toLowerCase()
  return locales.find(
    (locale) =>
      locale.toLowerCase() === normalized || locale.split('-')[0] === normalized.split('-')[0],
  )
}
