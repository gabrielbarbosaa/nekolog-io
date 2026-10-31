import { type ApiKey, parseApiKey } from '@internal/adapters'

export const KEY_QUERY_PARAM = 'key'

export type KeyLocation = 'header' | 'query'

export type FoundKey = { key: ApiKey; location: KeyLocation }

export type KeyLookup =
  | { ok: true; found: FoundKey }
  | { ok: false; code: 'invalid_key' | 'secret_key_in_url'; message: string }

function bearerToken(header: string | null): string | null {
  if (header === null) {
    return null
  }
  const match = /^Bearer[ \t]+(\S+)$/i.exec(header.trim())
  return match?.[1] ?? null
}

export function keyFromRequest(request: Request): KeyLookup {
  const fromQuery = parseApiKey(new URL(request.url).searchParams.get(KEY_QUERY_PARAM))

  if (fromQuery?.kind === 'secret') {
    return {
      ok: false,
      code: 'secret_key_in_url',
      message: 'A secret key must travel in the Authorization header, never in the URL',
    }
  }

  const fromHeader = parseApiKey(bearerToken(request.headers.get('authorization')))
  if (fromHeader !== null) {
    return { ok: true, found: { key: fromHeader, location: 'header' } }
  }

  if (fromQuery === null) {
    return { ok: false, code: 'invalid_key', message: 'No usable API key on this request' }
  }

  return { ok: true, found: { key: fromQuery, location: 'query' } }
}
