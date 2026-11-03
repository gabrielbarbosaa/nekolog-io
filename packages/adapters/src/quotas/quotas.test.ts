import { describe, expect, it, vi } from 'vitest'
import type { KvNamespace } from '../kv.ts'
import type { QuotaBlock, QuotaStore } from '../quota-store.ts'
import { cachedBlockedEnvironments } from './cached-blocks.ts'
import {
  kvQuotaStore,
  parseQuotaBlocks,
  QUOTA_BLOCKS_KEY,
  serialiseQuotaBlocks,
} from './kv-quota-store.ts'
import { memoryQuotaStore } from './memory-quota-store.ts'

const BLOCK: QuotaBlock = {
  environmentId: 'e_1',
  blockedAt: Date.UTC(2026, 9, 31, 12, 0, 0),
  events: 10_500,
  quota: 10_000,
}

function fakeKv() {
  const values = new Map<string, string>()
  return {
    values,
    namespace: {
      async get(key: string) {
        return values.get(key) ?? null
      },
      async put(key: string, value: string) {
        values.set(key, value)
      },
      async delete(key: string) {
        values.delete(key)
      },
    } as KvNamespace,
  }
}

describe('memoryQuotaStore', () => {
  it('hands back what it was given', async () => {
    const store = memoryQuotaStore([BLOCK])

    expect(await store.blocked()).toEqual([BLOCK])
  })

  it('replaces the whole set rather than merging', async () => {
    const store = memoryQuotaStore([BLOCK])

    await store.replace([{ ...BLOCK, environmentId: 'e_2' }])

    expect((await store.blocked()).map((block) => block.environmentId)).toEqual(['e_2'])
  })

  it('does not let a caller mutate what it stored', async () => {
    const store = memoryQuotaStore([BLOCK])
    const blocks = await store.blocked()
    const first = blocks[0]
    if (first !== undefined) {
      first.events = 0
    }

    expect((await store.blocked())[0]?.events).toBe(10_500)
  })
})

describe('kvQuotaStore', () => {
  it('keeps every block in a single document', async () => {
    const kv = fakeKv()
    const store = kvQuotaStore(kv.namespace)

    await store.replace([BLOCK, { ...BLOCK, environmentId: 'e_2' }])

    expect([...kv.values.keys()]).toEqual([QUOTA_BLOCKS_KEY])
    expect((await store.blocked()).map((block) => block.environmentId)).toEqual(['e_1', 'e_2'])
  })

  it('round trips the detail of a block', async () => {
    const kv = fakeKv()
    const store = kvQuotaStore(kv.namespace)

    await store.replace([BLOCK])

    expect(await store.blocked()).toEqual([BLOCK])
  })

  it('removes the document when nothing is blocked', async () => {
    const kv = fakeKv()
    const store = kvQuotaStore(kv.namespace)

    await store.replace([BLOCK])
    await store.replace([])

    expect(kv.values.size).toBe(0)
    expect(await store.blocked()).toEqual([])
  })

  it('reports nothing blocked when the document was never written', async () => {
    expect(await kvQuotaStore(fakeKv().namespace).blocked()).toEqual([])
  })

  it.each(['not json', '[]', '[{"environmentId":"e_1"}]', '["e_1","e_2"]', 'null', '"text"', '42'])(
    'treats the unreadable document %s as nothing blocked',
    (raw) => {
      expect(parseQuotaBlocks(raw)).toEqual([])
    },
  )

  it('keeps the block even when its detail is missing or wrong', () => {
    expect(parseQuotaBlocks('{"e_1":null,"e_2":{"events":"lots","quota":-3}}')).toEqual([
      { environmentId: 'e_1', blockedAt: 0, events: 0, quota: 0 },
      { environmentId: 'e_2', blockedAt: 0, events: 0, quota: 0 },
    ])
  })

  it('never writes an entry without an environment', () => {
    expect(serialiseQuotaBlocks([{ ...BLOCK, environmentId: '' }])).toBe('{}')
  })
})

function failingStore(error: Error): QuotaStore {
  return {
    async blocked() {
      throw error
    },
    async replace() {},
  }
}

describe('cachedBlockedEnvironments', () => {
  it('asks the store once and answers from memory until the ttl runs out', async () => {
    const store = memoryQuotaStore([BLOCK])
    const blocked = vi.spyOn(store, 'blocked')
    let at = 0
    const blocks = cachedBlockedEnvironments(store, { ttlMs: 60_000, now: () => at })

    expect(await blocks.isBlocked('e_1')).toBe(true)
    expect(await blocks.isBlocked('e_2')).toBe(false)
    at = 59_999
    expect(await blocks.isBlocked('e_1')).toBe(true)
    expect(blocked).toHaveBeenCalledTimes(1)

    at = 60_001
    await blocks.isBlocked('e_1')
    expect(blocked).toHaveBeenCalledTimes(2)
  })

  it('sees a block that was added after the ttl expired', async () => {
    const store = memoryQuotaStore()
    let at = 0
    const blocks = cachedBlockedEnvironments(store, { ttlMs: 60_000, now: () => at })

    expect(await blocks.isBlocked('e_1')).toBe(false)
    await store.replace([BLOCK])
    expect(await blocks.isBlocked('e_1')).toBe(false)

    at = 60_001
    expect(await blocks.isBlocked('e_1')).toBe(true)
  })

  it('keeps enforcing the last set it managed to read when the store breaks', async () => {
    const store = memoryQuotaStore([BLOCK])
    let at = 0
    let broken = false
    const errors: unknown[] = []
    const blocks = cachedBlockedEnvironments(
      {
        async blocked() {
          if (broken) {
            throw new Error('KV is unreachable')
          }
          return store.blocked()
        },
        async replace() {},
      },
      { ttlMs: 60_000, retryMs: 5_000, now: () => at, onError: (error) => errors.push(error) },
    )

    expect(await blocks.isBlocked('e_1')).toBe(true)
    broken = true
    at = 60_001

    expect(await blocks.isBlocked('e_1')).toBe(true)
    expect(errors).toHaveLength(1)
  })

  it('lets traffic through when it has never managed to read the store', async () => {
    const errors: unknown[] = []
    const blocks = cachedBlockedEnvironments(failingStore(new Error('cold start, KV is down')), {
      onError: (error) => errors.push(error),
    })

    expect(await blocks.isBlocked('e_1')).toBe(false)
    expect(errors).toHaveLength(1)
  })

  it('waits before hammering a store that just failed', async () => {
    const store = failingStore(new Error('down'))
    const blocked = vi.spyOn(store, 'blocked')
    let at = 0
    const blocks = cachedBlockedEnvironments(store, { retryMs: 5_000, now: () => at })

    await blocks.isBlocked('e_1')
    at = 4_999
    await blocks.isBlocked('e_1')
    expect(blocked).toHaveBeenCalledTimes(1)

    at = 5_001
    await blocks.isBlocked('e_1')
    expect(blocked).toHaveBeenCalledTimes(2)
  })

  it('reads the store once for a burst of requests that arrive together', async () => {
    const store = memoryQuotaStore([BLOCK])
    const blocked = vi.spyOn(store, 'blocked')
    const blocks = cachedBlockedEnvironments(store)

    const answers = await Promise.all([
      blocks.isBlocked('e_1'),
      blocks.isBlocked('e_1'),
      blocks.isBlocked('e_2'),
    ])

    expect(answers).toEqual([true, true, false])
    expect(blocked).toHaveBeenCalledTimes(1)
  })

  it('survives a reporter that throws', async () => {
    const blocks = cachedBlockedEnvironments(failingStore(new Error('down')), {
      onError: () => {
        throw new Error('the logger is broken too')
      },
    })

    expect(await blocks.isBlocked('e_1')).toBe(false)
  })
})
