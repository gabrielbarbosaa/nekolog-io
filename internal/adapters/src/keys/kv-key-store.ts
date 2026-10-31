import type { KeyRecord, KeyStore } from '../key-store'

export type KvNamespace = {
  get(key: string, type: 'text'): Promise<string | null>
  put(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

export const KEY_PREFIX = 'key:'

export function kvKeyFor(keyHash: string): string {
  return `${KEY_PREFIX}${keyHash}`
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  const items = value.filter((item): item is string => typeof item === 'string')
  return items.length === value.length ? items : null
}

export function parseKeyRecord(raw: string): KeyRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }

  const candidate = parsed as Record<string, unknown>
  const { projectId, environmentId } = candidate
  if (typeof projectId !== 'string' || projectId === '') {
    return null
  }
  if (typeof environmentId !== 'string' || environmentId === '') {
    return null
  }

  const scopes = asStringArray(candidate.scopes)
  if (scopes === null) {
    return null
  }

  const allowlist =
    candidate.originAllowlist === null || candidate.originAllowlist === undefined
      ? null
      : asStringArray(candidate.originAllowlist)
  if (
    allowlist === null &&
    candidate.originAllowlist !== null &&
    candidate.originAllowlist !== undefined
  ) {
    return null
  }

  return {
    projectId,
    environmentId,
    scopes: scopes.filter(
      (scope): scope is KeyRecord['scopes'][number] =>
        scope === 'logs:write' || scope === 'logs:read',
    ),
    originAllowlist: allowlist,
    blocked: candidate.blocked === true,
  }
}

export function kvKeyStore(namespace: KvNamespace): KeyStore {
  return {
    async get(keyHash) {
      const raw = await namespace.get(kvKeyFor(keyHash), 'text')
      return raw === null ? null : parseKeyRecord(raw)
    },
    async set(keyHash, record) {
      await namespace.put(kvKeyFor(keyHash), JSON.stringify(record))
    },
    async delete(keyHash) {
      await namespace.delete(kvKeyFor(keyHash))
    },
  }
}
