import { cookies, headers } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import { defaultLocale, LOCALE_COOKIE, type Locale, matchLocale } from './locales'

function resolveLocale(cookieValue: string | undefined, acceptLanguage: string | null): Locale {
  if (cookieValue) {
    const match = matchLocale(cookieValue)
    if (match) return match
  }

  if (acceptLanguage) {
    for (const part of acceptLanguage.split(',')) {
      const tag = part.split(';')[0]
      if (!tag) continue
      const match = matchLocale(tag)
      if (match) return match
    }
  }

  return defaultLocale
}

export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()])
  const locale = resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value,
    headerStore.get('accept-language'),
  )

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  }
})
