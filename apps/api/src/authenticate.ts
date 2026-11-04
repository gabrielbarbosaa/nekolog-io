import { hashApiKey, type KeyRecord, type KeyStore, parseApiKey } from '@nekolog-io/adapters'
import type { ApiErrorCode } from './errors.ts'

export const READ_SCOPE = 'logs:read'
export const WRITE_SCOPE = 'logs:write'
export const KEY_QUERY_PARAM = 'key'

export type ApiScope = typeof READ_SCOPE | typeof WRITE_SCOPE

export type ApiPrincipal = {
  projectId: string
  environmentId: string
  retentionDays?: number
}

export type AuthOutcome =
  | { ok: true; principal: ApiPrincipal }
  | { ok: false; code: ApiErrorCode; message: string }

export type Authenticator = (request: Request) => AuthOutcome | Promise<AuthOutcome>

export type KeyAuthenticatorOptions = {
  keyStore: KeyStore
  hash?: (value: string) => Promise<string>
}

export type ScopedAuthenticatorOptions = KeyAuthenticatorOptions & {
  scope: ApiScope
}

function bearerToken(header: string | null): string | null {
  if (header === null) {
    return null
  }
  const match = /^Bearer[ \t]+(\S+)$/i.exec(header.trim())
  return match?.[1] ?? null
}

export function createScopedAuthenticator(options: ScopedAuthenticatorOptions): Authenticator {
  const hash = options.hash ?? hashApiKey

  return async (request): Promise<AuthOutcome> => {
    if (new URL(request.url).searchParams.has(KEY_QUERY_PARAM)) {
      return {
        ok: false,
        code: 'secret_key_in_url',
        message: 'This API reads the key from Authorization: Bearer, never from the URL',
      }
    }

    const key = parseApiKey(bearerToken(request.headers.get('authorization')))
    if (key === null) {
      return { ok: false, code: 'invalid_key', message: 'No usable API key on this request' }
    }

    if (key.kind !== 'secret') {
      return {
        ok: false,
        code: 'invalid_key',
        message: 'This API refuses a public key: it is published to every browser',
      }
    }

    const record: KeyRecord | null = await options.keyStore.get(await hash(key.value))
    if (record === null) {
      return { ok: false, code: 'invalid_key', message: 'Unknown or revoked API key' }
    }

    if (!record.scopes.includes(options.scope)) {
      return {
        ok: false,
        code: 'insufficient_scope',
        message: `This key does not carry the ${options.scope} scope`,
      }
    }

    const principal: ApiPrincipal = {
      projectId: record.projectId,
      environmentId: record.environmentId,
    }
    if (record.retentionDays !== undefined) {
      principal.retentionDays = record.retentionDays
    }
    return { ok: true, principal }
  }
}

export function createReadAuthenticator(options: KeyAuthenticatorOptions): Authenticator {
  return createScopedAuthenticator({ ...options, scope: READ_SCOPE })
}

export function createWriteAuthenticator(options: KeyAuthenticatorOptions): Authenticator {
  return createScopedAuthenticator({ ...options, scope: WRITE_SCOPE })
}
