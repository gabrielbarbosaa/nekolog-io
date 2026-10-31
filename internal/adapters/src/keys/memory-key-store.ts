import type { KeyRecord, KeyStore } from '../key-store'

export type MemoryKeyStore = KeyStore & {
  readonly size: number
  clear(): void
}

export function memoryKeyStore(initial: Record<string, KeyRecord> = {}): MemoryKeyStore {
  const records = new Map<string, KeyRecord>(Object.entries(initial))

  return {
    get size() {
      return records.size
    },
    async get(keyHash) {
      return records.get(keyHash) ?? null
    },
    async set(keyHash, record) {
      records.set(keyHash, record)
    },
    async delete(keyHash) {
      records.delete(keyHash)
    },
    clear() {
      records.clear()
    },
  }
}
