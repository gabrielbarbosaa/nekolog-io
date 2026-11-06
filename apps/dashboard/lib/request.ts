export const UNKNOWN_IP = '0.0.0.0'

export function addressOf(headers: Headers): string {
  const direct = headers.get('cf-connecting-ip')
  if (direct !== null && direct.trim() !== '') {
    return direct.trim()
  }

  const forwarded = headers.get('x-forwarded-for')
  if (forwarded === null) {
    return UNKNOWN_IP
  }

  const hops = forwarded
    .split(',')
    .map((hop) => hop.trim())
    .filter((hop) => hop !== '')

  return hops.at(-1) ?? UNKNOWN_IP
}

export function deviceOf(headers: Headers): string {
  const agent = headers.get('user-agent') ?? ''
  const browser = /(Firefox|Edg|Chrome|Safari)\/[\d.]+/.exec(agent)?.[1]
  const system = /\((?:[^;)]*;\s*)?([^;)]{0,30})/.exec(agent)?.[1]?.trim()

  if (browser === undefined) {
    return 'unknown'
  }
  return system === undefined || system === '' ? browser : `${browser} on ${system}`
}

export function countryOf(headers: Headers): string {
  const country = headers.get('cf-ipcountry')
  return country !== null && /^[A-Z]{2}$/.test(country) ? country : '??'
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await request.json()
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function stringField(body: Record<string, unknown>, name: string): string {
  const value = body[name]
  return typeof value === 'string' ? value : ''
}

export function booleanField(body: Record<string, unknown>, name: string): boolean {
  return body[name] === true
}
