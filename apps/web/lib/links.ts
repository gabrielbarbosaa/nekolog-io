import type { Locale } from '@/i18n/locales'

export const DOCS_URL = 'https://nekolog.io/docs/'
export const CONTACT_URL = 'mailto:contato@nekolog.io'

const DOCS_PREFIX: Record<Locale, string> = {
  en: '',
  'pt-BR': 'pt-br/',
  es: 'es/',
}

export function docsUrl(locale: Locale, path = ''): string {
  return `${DOCS_URL}${DOCS_PREFIX[locale]}${path}`
}
