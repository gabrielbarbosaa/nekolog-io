import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { KeyRecord } from '../key-store.ts'
import type { KvNamespace } from '../kv.ts'
import { firstKeyStore } from './first-key-store.ts'
import { kvKeyFor, kvKeyStore, parseKeyRecord } from './kv-key-store.ts'
import { KEY_INDEX_KEY, keyDigest, parseKeyIndex, publishKeys, readKeyIndex } from './publish.ts'

function fakeKv(): { namespace: KvNamespace; store: Map<string, string>; writes: string[] } {
  const store = new Map<string, string>()
  const writes: string[] = []
  return {
    store,
    writes,
    namespace: {
      async get(key) {
        return store.get(key) ?? null
      },
      async put(key, value) {
        writes.push(key)
        store.set(key, value)
      },
      async delete(key) {
        writes.push(`delete ${key}`)
        store.delete(key)
      },
    },
  }
}

const RECORD: KeyRecord = {
  projectId: 'prj_1',
  environmentId: 'env_1',
  keyId: 'key_1',
  scopes: ['logs:write'],
  originAllowlist: null,
  blocked: false,
  retentionDays: 7,
  minLevel: 'info',
  sampleRate: 0.5,
  redaction: { patterns: ['email'] },
}

describe('a record going into the KV and coming back', () => {
  it('keeps every field, because the ingestion reads it from there', async () => {
    const { namespace } = fakeKv()
    const store = kvKeyStore(namespace)

    await store.set('abc', RECORD)

    expect(await store.get('abc')).toEqual(RECORD)
  })

  it('carries every field the KeyRecord type declares', () => {
    const declared = readFileSync(
      fileURLToPath(new URL('../key-store.ts', import.meta.url)),
      'utf8',
    )
    const source = readFileSync(
      fileURLToPath(new URL('./kv-key-store.ts', import.meta.url)),
      'utf8',
    )

    const fields = [...declared.matchAll(/^ {2}(\w+)\??:/gm)].map((match) => match[1] as string)

    expect(fields.length).toBeGreaterThanOrEqual(8)
    for (const field of fields) {
      expect(source, `parseKeyRecord never looks at ${field}`).toContain(field)
    }
  })

  it('refuses a record that names no project or environment', () => {
    expect(parseKeyRecord(JSON.stringify({ environmentId: 'env_1' }))).toBeNull()
    expect(parseKeyRecord('not json')).toBeNull()
  })
})

describe('the digest a publish compares against', () => {
  it('does not change when the same fields arrive in another order', () => {
    const shuffled: KeyRecord = {
      blocked: false,
      sampleRate: 0.5,
      scopes: ['logs:write'],
      minLevel: 'info',
      retentionDays: 7,
      redaction: { patterns: ['email'] },
      keyId: 'key_1',
      originAllowlist: null,
      environmentId: 'env_1',
      projectId: 'prj_1',
    }

    expect(keyDigest(shuffled)).toBe(keyDigest(RECORD))
  })

  it('changes when a setting changes, which is what carries an edit through', () => {
    expect(keyDigest({ ...RECORD, retentionDays: 30 })).not.toBe(keyDigest(RECORD))
    expect(keyDigest({ ...RECORD, minLevel: 'error' })).not.toBe(keyDigest(RECORD))
  })
})

describe('publishing the keys a database holds', () => {
  it('writes each one and remembers what it wrote', async () => {
    const kv = fakeKv()

    const published = await publishKeys(kv.namespace, [{ keyHash: 'h1', record: RECORD }])

    expect(published).toEqual({ written: 1, removed: 0, unchanged: 0, indexWritten: true })
    expect(kv.store.get(kvKeyFor('h1'))).toBeDefined()
    expect(await readKeyIndex(kv.namespace)).toEqual({ h1: keyDigest(RECORD) })
  })

  it('writes nothing at all on a second run that found the same keys', async () => {
    const kv = fakeKv()
    await publishKeys(kv.namespace, [{ keyHash: 'h1', record: RECORD }])
    kv.writes.length = 0

    const again = await publishKeys(kv.namespace, [{ keyHash: 'h1', record: RECORD }])

    expect(again).toEqual({ written: 0, removed: 0, unchanged: 1, indexWritten: false })
    expect(kv.writes, 'a run that changed nothing must not touch the KV').toEqual([])
  })

  it('rewrites only the key whose environment settings moved', async () => {
    const kv = fakeKv()
    await publishKeys(kv.namespace, [
      { keyHash: 'h1', record: RECORD },
      { keyHash: 'h2', record: { ...RECORD, keyId: 'key_2' } },
    ])
    kv.writes.length = 0

    const moved = await publishKeys(kv.namespace, [
      { keyHash: 'h1', record: { ...RECORD, retentionDays: 30 } },
      { keyHash: 'h2', record: { ...RECORD, keyId: 'key_2' } },
    ])

    expect(moved.written).toBe(1)
    expect(moved.unchanged).toBe(1)
    expect(kv.writes).toEqual([kvKeyFor('h1'), KEY_INDEX_KEY])
  })

  it('removes a key the database no longer holds, which is what a revocation is', async () => {
    const kv = fakeKv()
    await publishKeys(kv.namespace, [
      { keyHash: 'h1', record: RECORD },
      { keyHash: 'h2', record: { ...RECORD, keyId: 'key_2' } },
    ])

    const after = await publishKeys(kv.namespace, [{ keyHash: 'h1', record: RECORD }])

    expect(after.removed).toBe(1)
    expect(kv.store.has(kvKeyFor('h2'))).toBe(false)
    expect(Object.keys(await readKeyIndex(kv.namespace))).toEqual(['h1'])
  })

  it('removes a key whose whole project was deleted, which leaves no row to look at', async () => {
    const kv = fakeKv()
    await publishKeys(kv.namespace, [{ keyHash: 'h1', record: RECORD }])

    expect((await publishKeys(kv.namespace, [])).removed).toBe(1)
    expect(kv.store.has(kvKeyFor('h1'))).toBe(false)
  })

  it('reads a broken index as an empty one rather than throwing', async () => {
    expect(parseKeyIndex('nonsense')).toEqual({})
    expect(parseKeyIndex('[1, 2]')).toEqual({})
    expect(parseKeyIndex(null)).toEqual({})
    expect(parseKeyIndex('{"h1": 7}')).toEqual({})
  })
})

describe('a store that asks one place and then another', () => {
  it('answers from the first that knows the key', async () => {
    const first = kvKeyStore(fakeKv().namespace)
    const second = kvKeyStore(fakeKv().namespace)
    await second.set('h1', RECORD)

    const chained = firstKeyStore(first, second)

    expect(await chained.get('h1')).toEqual(RECORD)
    expect(await chained.get('h2')).toBeNull()
  })

  it('prefers the first when both know it', async () => {
    const one = fakeKv()
    const two = fakeKv()
    await kvKeyStore(one.namespace).set('h1', RECORD)
    await kvKeyStore(two.namespace).set('h1', { ...RECORD, retentionDays: 99 })

    expect(
      (await firstKeyStore(kvKeyStore(one.namespace), kvKeyStore(two.namespace)).get('h1'))
        ?.retentionDays,
    ).toBe(7)
  })

  it('writes only to the first, so a fallback is never edited by accident', async () => {
    const one = fakeKv()
    const two = fakeKv()
    const chained = firstKeyStore(kvKeyStore(one.namespace), kvKeyStore(two.namespace))

    await chained.set('h1', RECORD)
    await chained.delete('h1')

    expect(two.writes).toEqual([])
  })

  it('refuses to be built out of nothing', () => {
    expect(() => firstKeyStore()).toThrow(/answer for nobody/)
  })
})
