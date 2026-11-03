import { describe, expect, it, vi } from 'vitest'
import type { KeyRecord } from '../key-store.ts'
import type { KvNamespace } from '../kv.ts'
import { cachedKeyStore } from './cached-key-store.ts'
import {
  generateApiKey,
  hashApiKey,
  MAX_KEY_SECRET_CHARS,
  MIN_KEY_SECRET_CHARS,
  PUBLIC_KEY_PREFIX,
  parseApiKey,
  SECRET_KEY_PREFIX,
} from './format.ts'
import { kvKeyFor, kvKeyStore, parseKeyRecord } from './kv-key-store.ts'
import { memoryKeyStore } from './memory-key-store.ts'

const RECORD: KeyRecord = {
  projectId: 'p_1',
  environmentId: 'e_1',
  scopes: ['logs:write'],
  originAllowlist: null,
  blocked: false,
}

describe('parseApiKey', () => {
  it('reads a public key', () => {
    expect(parseApiKey(`${PUBLIC_KEY_PREFIX}abcdefghijklmnop`)).toEqual({
      kind: 'public',
      value: `${PUBLIC_KEY_PREFIX}abcdefghijklmnop`,
    })
  })

  it('reads a secret key', () => {
    expect(parseApiKey(`${SECRET_KEY_PREFIX}abcdefghijklmnop`)?.kind).toBe('secret')
  })

  it.each([
    ['no prefix', 'abcdefghijklmnop'],
    ['the wrong prefix', 'nekolog_xx_abcdefghijklmnop'],
    ['a prefix and nothing else', PUBLIC_KEY_PREFIX],
    ['a secret that is too short', `${PUBLIC_KEY_PREFIX}${'a'.repeat(MIN_KEY_SECRET_CHARS - 1)}`],
    ['a secret that is too long', `${PUBLIC_KEY_PREFIX}${'a'.repeat(MAX_KEY_SECRET_CHARS + 1)}`],
    ['characters outside the alphabet', `${PUBLIC_KEY_PREFIX}abcdefghijklmno!`],
    ['whitespace inside', `${PUBLIC_KEY_PREFIX}abcdefgh ijklmnop`],
  ])('refuses %s', (_name, value) => {
    expect(parseApiKey(value)).toBeNull()
  })

  it.each([null, undefined, 42, {}, []])('refuses the non-string %s', (value) => {
    expect(parseApiKey(value)).toBeNull()
  })

  it('does not take a key that merely contains the prefix', () => {
    expect(parseApiKey(`see nekolog_pk_abcdefghijklmnop`)).toBeNull()
  })
})

describe('generateApiKey', () => {
  it('mints a key its own parser accepts', () => {
    for (const kind of ['public', 'secret'] as const) {
      const key = generateApiKey(kind)
      expect(parseApiKey(key)).toEqual({ kind, value: key })
    }
  })

  it('does not repeat itself', () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateApiKey('public')))

    expect(keys.size).toBe(200)
  })

  it('takes the randomness it is given', () => {
    const bytes = (size: number) => new Uint8Array(size).fill(0)

    expect(generateApiKey('public', bytes)).toBe(`${PUBLIC_KEY_PREFIX}${'a'.repeat(32)}`)
  })
})

describe('hashApiKey', () => {
  it('is the SHA-256 hex of the whole key', async () => {
    expect(await hashApiKey('nekolog_pk_abcdefghijklmnop')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is stable', async () => {
    const key = 'nekolog_sk_abcdefghijklmnop'

    expect(await hashApiKey(key)).toBe(await hashApiKey(key))
  })

  it('separates keys that differ by one character', async () => {
    expect(await hashApiKey('nekolog_pk_abcdefghijklmnop')).not.toBe(
      await hashApiKey('nekolog_pk_abcdefghijklmnoq'),
    )
  })

  it('separates a public key from a secret one with the same secret', async () => {
    expect(await hashApiKey(`${PUBLIC_KEY_PREFIX}abcdefghijklmnop`)).not.toBe(
      await hashApiKey(`${SECRET_KEY_PREFIX}abcdefghijklmnop`),
    )
  })
})

describe('memoryKeyStore', () => {
  it('stores, reads and forgets', async () => {
    const store = memoryKeyStore()

    expect(await store.get('h')).toBeNull()
    await store.set('h', RECORD)
    expect(await store.get('h')).toEqual(RECORD)
    await store.delete('h')
    expect(await store.get('h')).toBeNull()
  })

  it('takes records up front', async () => {
    const store = memoryKeyStore({ h: RECORD })

    expect(store.size).toBe(1)
    expect(await store.get('h')).toEqual(RECORD)
  })
})

function fakeKv(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const namespace: KvNamespace = {
    async get(key) {
      return values.get(key) ?? null
    },
    async put(key, value) {
      values.set(key, value)
    },
    async delete(key) {
      values.delete(key)
    },
  }
  return { namespace, values }
}

describe('kvKeyStore', () => {
  it('namespaces the key so the KV can hold other things', async () => {
    const { namespace, values } = fakeKv()
    const store = kvKeyStore(namespace)

    await store.set('abc', RECORD)

    expect([...values.keys()]).toEqual([kvKeyFor('abc')])
  })

  it('round trips a record', async () => {
    const { namespace } = fakeKv()
    const store = kvKeyStore(namespace)

    await store.set('abc', { ...RECORD, originAllowlist: ['https://a.test'], blocked: true })

    expect(await store.get('abc')).toEqual({
      ...RECORD,
      originAllowlist: ['https://a.test'],
      blocked: true,
    })
  })

  it('answers null for a key the KV does not have', async () => {
    expect(await kvKeyStore(fakeKv().namespace).get('missing')).toBeNull()
  })

  it('treats a corrupted record as no record at all', async () => {
    const { namespace } = fakeKv({ [kvKeyFor('abc')]: 'not json' })

    expect(await kvKeyStore(namespace).get('abc')).toBeNull()
  })
})

describe('parseKeyRecord', () => {
  it('fills in a missing blocked flag as false', () => {
    const parsed = parseKeyRecord(
      JSON.stringify({ projectId: 'p', environmentId: 'e', scopes: [], originAllowlist: null }),
    )

    expect(parsed?.blocked).toBe(false)
  })

  it('drops a scope it does not know, instead of trusting it', () => {
    const parsed = parseKeyRecord(
      JSON.stringify({
        projectId: 'p',
        environmentId: 'e',
        scopes: ['logs:write', 'admin:everything'],
        originAllowlist: null,
      }),
    )

    expect(parsed?.scopes).toEqual(['logs:write'])
  })

  it.each([
    ['no project', { environmentId: 'e', scopes: [] }],
    ['an empty project', { projectId: '', environmentId: 'e', scopes: [] }],
    ['no environment', { projectId: 'p', scopes: [] }],
    ['scopes that are not a list', { projectId: 'p', environmentId: 'e', scopes: 'logs:write' }],
    [
      'an allowlist that is not a list of strings',
      {
        projectId: 'p',
        environmentId: 'e',
        scopes: [],
        originAllowlist: [1, 2],
      },
    ],
  ])('refuses a record with %s', (_name, value) => {
    expect(parseKeyRecord(JSON.stringify(value))).toBeNull()
  })
})

describe('cachedKeyStore', () => {
  it('asks the store once inside the window', async () => {
    const inner = memoryKeyStore({ h: RECORD })
    const get = vi.spyOn(inner, 'get')
    let clock = 0
    const store = cachedKeyStore(inner, { ttlMs: 1000, now: () => clock })

    await store.get('h')
    clock = 999
    await store.get('h')

    expect(get).toHaveBeenCalledTimes(1)
  })

  it('asks again once the window has passed', async () => {
    const inner = memoryKeyStore({ h: RECORD })
    const get = vi.spyOn(inner, 'get')
    let clock = 0
    const store = cachedKeyStore(inner, { ttlMs: 1000, now: () => clock })

    await store.get('h')
    clock = 1001
    await store.get('h')

    expect(get).toHaveBeenCalledTimes(2)
  })

  it('remembers that a key does not exist, so a bad key is not a lookup every time', async () => {
    const inner = memoryKeyStore()
    const get = vi.spyOn(inner, 'get')
    const store = cachedKeyStore(inner, { ttlMs: 1000, now: () => 0 })

    expect(await store.get('nope')).toBeNull()
    expect(await store.get('nope')).toBeNull()
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('does not serve a revoked key from its own cache', async () => {
    const inner = memoryKeyStore({ h: RECORD })
    const store = cachedKeyStore(inner, { ttlMs: 60_000, now: () => 0 })

    await store.get('h')
    await store.delete('h')

    expect(await store.get('h')).toBeNull()
  })

  it('does not serve a stale record after a write through it', async () => {
    const inner = memoryKeyStore({ h: RECORD })
    const store = cachedKeyStore(inner, { ttlMs: 60_000, now: () => 0 })

    await store.get('h')
    await store.set('h', { ...RECORD, blocked: true })

    expect((await store.get('h'))?.blocked).toBe(true)
  })

  it('keeps the cache from growing without a bound', async () => {
    const inner = memoryKeyStore()
    const get = vi.spyOn(inner, 'get')
    const store = cachedKeyStore(inner, { ttlMs: 60_000, maxEntries: 2, now: () => 0 })

    await store.get('a')
    await store.get('b')
    await store.get('c')
    await store.get('a')

    expect(get).toHaveBeenCalledTimes(4)
  })

  it('caches nothing when the window is zero', async () => {
    const inner = memoryKeyStore({ h: RECORD })
    const get = vi.spyOn(inner, 'get')
    const store = cachedKeyStore(inner, { ttlMs: 0, now: () => 0 })

    await store.get('h')
    await store.get('h')

    expect(get).toHaveBeenCalledTimes(2)
  })
})
