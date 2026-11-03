export type PageDetail = 'path' | 'full' | false

export const DEFAULT_PAGE_DETAIL: PageDetail = 'path'

export const PAGE_PROTOCOLS: readonly string[] = ['http:', 'https:', 'file:']

export function pageUrl(
  href: string | undefined,
  detail: PageDetail,
  base?: string,
): string | undefined {
  if (detail === false || typeof href !== 'string' || href === '') {
    return undefined
  }

  let url: URL
  try {
    url = new URL(href, base)
  } catch {
    return undefined
  }

  if (!PAGE_PROTOCOLS.includes(url.protocol)) {
    return undefined
  }

  if (detail === 'full') {
    return url.href
  }

  url.search = ''
  url.hash = ''
  return url.href
}
