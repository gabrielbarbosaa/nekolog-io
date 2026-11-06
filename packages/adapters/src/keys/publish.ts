import type { KeyRecord } from '../key-store.ts'
import type { KvNamespace } from '../kv.ts'
import { kvKeyStore } from './kv-key-store.ts'

export const KEY_INDEX_KEY = 'keys:index'

export type PublishedKey = {
  keyHash: string
  record: KeyRecord
}

export type KeyIndex = Record<string, string>

export type Published = {
  written: number
  removed: number
  unchanged: number
  indexWritten: boolean
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stable)
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, one]) => one !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    return Object.fromEntries(entries.map(([key, one]) => [key, stable(one)]))
  }
  return value
}

export function keyDigest(record: KeyRecord): string {
  return JSON.stringify(stable(record))
}

export function parseKeyIndex(raw: string | null): KeyIndex {
  if (raw === null) {
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {}
  }

  const index: KeyIndex = {}
  for (const [hash, digest] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof digest === 'string') {
      index[hash] = digest
    }
  }
  return index
}

export async function readKeyIndex(namespace: KvNamespace): Promise<KeyIndex> {
  return parseKeyIndex(await namespace.get(KEY_INDEX_KEY, 'text'))
}

export async function publishKeys(
  namespace: KvNamespace,
  wanted: ReadonlyArray<PublishedKey>,
): Promise<Published> {
  const store = kvKeyStore(namespace)
  const before = await readKeyIndex(namespace)
  const after: KeyIndex = {}
  const result: Published = { written: 0, removed: 0, unchanged: 0, indexWritten: false }

  for (const { keyHash, record } of wanted) {
    const digest = keyDigest(record)
    after[keyHash] = digest

    if (before[keyHash] === digest) {
      result.unchanged += 1
      continue
    }

    await store.set(keyHash, record)
    result.written += 1
  }

  for (const keyHash of Object.keys(before)) {
    if (after[keyHash] === undefined) {
      await store.delete(keyHash)
      result.removed += 1
    }
  }

  if (result.written > 0 || result.removed > 0) {
    await namespace.put(KEY_INDEX_KEY, JSON.stringify(after))
    result.indexWritten = true
  }

  return result
}
