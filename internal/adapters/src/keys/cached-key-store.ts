import type { KeyRecord, KeyStore } from '../key-store'

export const DEFAULT_KEY_CACHE_TTL_MS = 60_000
export const DEFAULT_KEY_CACHE_SIZE = 500

export type CachedKeyStoreOptions = {
  ttlMs?: number
  maxEntries?: number
  now?: () => number
}

type Entry = {
  record: KeyRecord | null
  expiresAt: number
}

export function cachedKeyStore(inner: KeyStore, options: CachedKeyStoreOptions = {}): KeyStore {
  const ttlMs = options.ttlMs ?? DEFAULT_KEY_CACHE_TTL_MS
  const maxEntries = options.maxEntries ?? DEFAULT_KEY_CACHE_SIZE
  const now = options.now ?? Date.now
  const entries = new Map<string, Entry>()

  const remember = (keyHash: string, record: KeyRecord | null): void => {
    if (ttlMs <= 0) {
      return
    }
    entries.delete(keyHash)
    entries.set(keyHash, { record, expiresAt: now() + ttlMs })
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next()
      if (oldest.done) {
        break
      }
      entries.delete(oldest.value)
    }
  }

  return {
    async get(keyHash) {
      const cached = entries.get(keyHash)
      if (cached !== undefined) {
        if (cached.expiresAt > now()) {
          return cached.record
        }
        entries.delete(keyHash)
      }

      const record = await inner.get(keyHash)
      remember(keyHash, record)
      return record
    },
    async set(keyHash, record) {
      await inner.set(keyHash, record)
      entries.delete(keyHash)
    },
    async delete(keyHash) {
      await inner.delete(keyHash)
      entries.delete(keyHash)
    },
  }
}
