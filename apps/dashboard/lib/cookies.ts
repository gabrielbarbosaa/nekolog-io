import { type CookieAttributes, cookieAttributes } from '@internal/auth'

type CookieWriter = {
  cookies: { set(name: string, value: string, options: CookieAttributes): unknown }
}

export function clearCookie(response: CookieWriter, name: string): void {
  response.cookies.set(name, '', cookieAttributes(0))
}

function pairs(header: string | null | undefined): Array<[string, string]> {
  if (header === null || header === undefined || header === '') {
    return []
  }
  return header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const at = part.indexOf('=')
      return at === -1
        ? ([part, ''] as [string, string])
        : ([part.slice(0, at), part.slice(at + 1)] as [string, string])
    })
}

export function cookieFrom(header: string | null | undefined, name: string): string | undefined {
  const found = pairs(header).find(([key]) => key === name)
  return found === undefined || found[1] === '' ? undefined : found[1]
}

export function withCookies(
  header: string | null | undefined,
  updates: Readonly<Record<string, string>>,
): string {
  const kept = pairs(header).filter(([key]) => !(key in updates))
  const written = Object.entries(updates).filter(([, value]) => value !== '')
  return [...kept, ...written].map(([key, value]) => `${key}=${value}`).join('; ')
}
