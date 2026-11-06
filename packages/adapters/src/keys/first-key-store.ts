import type { KeyStore } from '../key-store.ts'

export function firstKeyStore(...stores: ReadonlyArray<KeyStore>): KeyStore {
  if (stores.length === 0) {
    throw new Error('Refusing to build a key store that would answer for nobody')
  }
  const [head] = stores as [KeyStore, ...KeyStore[]]

  return {
    async get(keyHash) {
      for (const store of stores) {
        const record = await store.get(keyHash)
        if (record !== null) {
          return record
        }
      }
      return null
    },
    set: (keyHash, record) => head.set(keyHash, record),
    delete: (keyHash) => head.delete(keyHash),
  }
}
