import { hashApiKey, type KeyRecord, type KeyStore, originAllowed } from '@internal/adapters'
import type { Authenticator, AuthOutcome, IngestPrincipal } from './app.ts'
import { keyFromRequest } from './keys.ts'

export const WRITE_SCOPE = 'logs:write'

export type KeyAuthenticatorOptions = {
  keyStore: KeyStore
  hash?: (value: string) => Promise<string>
}

export function createKeyAuthenticator(options: KeyAuthenticatorOptions): Authenticator {
  const hash = options.hash ?? hashApiKey

  return async (request): Promise<AuthOutcome> => {
    const lookup = keyFromRequest(request)
    if (!lookup.ok) {
      return { ok: false, code: lookup.code, message: lookup.message }
    }

    const { key, location } = lookup.found
    const record: KeyRecord | null = await options.keyStore.get(await hash(key.value))

    if (record === null) {
      return { ok: false, code: 'invalid_key', message: 'Unknown or revoked API key' }
    }

    if (!record.scopes.includes(WRITE_SCOPE)) {
      return { ok: false, code: 'invalid_key', message: 'This key cannot write logs' }
    }

    if (record.blocked) {
      return {
        ok: false,
        code: 'quota_exceeded',
        message: 'This environment is over its quota',
      }
    }

    const origin = request.headers.get('origin')
    if (key.kind === 'public' && !originAllowed(record.originAllowlist, origin)) {
      return {
        ok: false,
        code: 'origin_not_allowed',
        message: origin === null ? 'This key requires an Origin' : `Origin not allowed: ${origin}`,
      }
    }

    const principal: IngestPrincipal = {
      projectId: record.projectId,
      environmentId: record.environmentId,
      keyKind: key.kind,
      keyLocation: location,
      allowedOrigin: key.kind === 'public' ? origin : null,
    }

    if (record.retentionDays !== undefined) {
      principal.retentionDays = record.retentionDays
    }

    return { ok: true, principal }
  }
}
