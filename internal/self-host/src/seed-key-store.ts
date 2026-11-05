import { readFileSync, statSync } from 'node:fs'
import { keyRecordsFor, parseSeedDocument, type SeedDocument } from '@internal/seed'
import type { KeyRecord, KeyStore } from '@nekolog-io/adapters'

export const DEFAULT_RELOAD_MS = 15_000

export type SeedKeyStoreOptions = {
  reloadMs?: number
  now?: () => number
  onReload?: (document: SeedDocument) => void
  onError?: (error: unknown) => void
}

export class ReadOnlyKeyStore extends Error {
  constructor() {
    super(
      'These keys come from the seed file. Change it with "pnpm seed" and the ingestion picks it up.',
    )
    this.name = 'ReadOnlyKeyStore'
  }
}

type Loaded = {
  stamp: string
  records: Map<string, KeyRecord>
}

function stampOf(path: string): string {
  const stats = statSync(path)
  return `${stats.mtimeMs}:${stats.size}`
}

function load(path: string): { loaded: Loaded; document: SeedDocument } {
  const stamp = stampOf(path)
  const document = parseSeedDocument(readFileSync(path, 'utf8'))
  const records = new Map<string, KeyRecord>()
  for (const entry of keyRecordsFor(document)) {
    records.set(entry.keyHash, entry.record)
  }
  return { loaded: { stamp, records }, document }
}

export function fileSeedKeyStore(path: string, options: SeedKeyStoreOptions = {}): KeyStore {
  const reloadMs = options.reloadMs ?? DEFAULT_RELOAD_MS
  const now = options.now ?? Date.now

  let current = load(path).loaded
  let checkedAt = now()

  const refresh = (): void => {
    if (now() - checkedAt < reloadMs) {
      return
    }
    checkedAt = now()
    try {
      if (stampOf(path) === current.stamp) {
        return
      }
      const next = load(path)
      current = next.loaded
      options.onReload?.(next.document)
    } catch (error) {
      options.onError?.(error)
    }
  }

  return {
    async get(keyHash) {
      refresh()
      return current.records.get(keyHash) ?? null
    },
    async set() {
      throw new ReadOnlyKeyStore()
    },
    async delete() {
      throw new ReadOnlyKeyStore()
    },
  }
}
