import type { Locale } from '@/i18n/locales'

export const GITHUB_URL = 'https://github.com/gabrielbarbosaa/nekolog-io'
export const DOCS_URL = 'https://nekolog.io/docs/'
export const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`

const DOCS_PREFIX: Record<Locale, string> = {
  en: '',
  'pt-BR': 'pt-br/',
  es: 'es/',
}

export function docsUrl(locale: Locale, path = ''): string {
  return `${DOCS_URL}${DOCS_PREFIX[locale]}${path}`
}
