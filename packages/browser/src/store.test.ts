import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  type BatchStore,
  DEFAULT_MAX_AGE_MS,
  doomed,
  indexedDbStore,
  memoryBatchStore,
  type PendingBatch,
  type StoredBatch,
} from './store.ts'

const NOW = Date.UTC(2026, 10, 3, 21, 0)

function batch(at: number, body = '{"events":[]}'): PendingBatch {
  return { at, url: 'https://ingest.nekolog.io/v1/logs', body }
}

function stored(id: number, offset: number, body = 'x'): StoredBatch {
  return { ...batch(NOW - 10_000 + offset, body), id }
}

describe('what gets thrown away', () => {
  it('keeps a fresh batch', () => {
    expect(doomed([stored(1, 0)], { now: NOW })).toEqual([])
  })

  it('throws away a batch nobody will ever want again', () => {
    const old = { ...stored(1, 0), at: NOW - DEFAULT_MAX_AGE_MS - 1 }

    expect(doomed([old, stored(2, 0)], { now: NOW })).toEqual([1])
  })

  it('throws away the oldest once there are too many', () => {
    const batches = [stored(1, 1), stored(2, 2), stored(3, 3)]

    expect(doomed(batches, { now: NOW, maxBatches: 2 })).toEqual([1])
  })

  it('throws away the oldest once they take too much room', () => {
    const batches = [stored(1, 1, 'aaaa'), stored(2, 2, 'bbbb'), stored(3, 3, 'cccc')]

    expect(doomed(batches, { now: NOW, maxBytes: 8 })).toEqual([1])
  })

  it('keeps the newest, not whichever came first in the list', () => {
    const batches = [stored(3, 3), stored(1, 1), stored(2, 2)]

    expect(doomed(batches, { now: NOW, maxBatches: 1 })).toEqual([1, 2])
  })

  it('throws away a single batch that is bigger than the whole budget', () => {
    expect(doomed([stored(1, 1, 'x'.repeat(100))], { now: NOW, maxBytes: 10 })).toEqual([1])
  })

  it('has nothing to do with an empty store', () => {
    expect(doomed([], { now: NOW })).toEqual([])
  })
})

function behavesLikeAStore(name: string, make: () => BatchStore): void {
  describe(name, () => {
    let store: BatchStore

    beforeEach(async () => {
      store = make()
      await store.clear()
    })

    it('gives back what it was given, oldest first', async () => {
      await store.put(batch(2))
      await store.put(batch(1))

      const rows = await store.list()

      expect(rows.map((row) => row.at)).toEqual([1, 2])
      expect(rows[0]?.body).toBe('{"events":[]}')
      expect(typeof rows[0]?.id).toBe('number')
    })

    it('gives back only as many as asked for', async () => {
      await store.put(batch(1))
      await store.put(batch(2))
      await store.put(batch(3))

      expect(await store.list(2)).toHaveLength(2)
    })

    it('forgets one that was sent', async () => {
      await store.put(batch(1))
      await store.put(batch(2))
      const [first] = await store.list()

      await store.remove((first as StoredBatch).id)

      expect((await store.list()).map((row) => row.at)).toEqual([2])
    })

    it('prunes what the rules say to prune', async () => {
      await store.put(batch(NOW - DEFAULT_MAX_AGE_MS - 1))
      await store.put(batch(NOW))

      const gone = await store.prune({ now: NOW })

      expect(gone).toBe(1)
      expect((await store.list()).map((row) => row.at)).toEqual([NOW])
    })

    it('empties on clear', async () => {
      await store.put(batch(1))

      await store.clear()

      expect(await store.list()).toEqual([])
    })

    it('gives each batch its own identifier', async () => {
      await store.put(batch(1))
      await store.put(batch(1))

      const rows = await store.list()

      expect(new Set(rows.map((row) => row.id)).size).toBe(2)
    })
  })
}

behavesLikeAStore('the store kept in memory', memoryBatchStore)
behavesLikeAStore('the store kept in indexeddb', () => {
  const store = indexedDbStore({ factory: new IDBFactory(), name: `nekolog-${Math.random()}` })
  if (store === undefined) {
    throw new Error('fake-indexeddb did not provide a factory')
  }
  return store
})

type Handler = (() => void) | undefined

function abortingFactory(): IDBFactory {
  const transaction = {
    error: new Error('the browser ran out of room'),
    onabort: undefined as Handler,
    onerror: undefined as Handler,
    oncomplete: undefined as Handler,
    objectStore: () => ({
      add: () => {
        const request = { onsuccess: undefined as Handler, onerror: undefined as Handler }
        queueMicrotask(() => request.onsuccess?.())
        return request
      },
    }),
  }

  const database = {
    objectStoreNames: { contains: () => true },
    transaction: () => {
      queueMicrotask(() => queueMicrotask(() => transaction.onabort?.()))
      return transaction
    },
  }

  return {
    open: () => {
      const request = { result: database, onsuccess: undefined as Handler }
      queueMicrotask(() => request.onsuccess?.())
      return request
    },
  } as unknown as IDBFactory
}

describe('a transaction the browser gives up on', () => {
  it('is reported as a refusal, not as a batch safely written down', async () => {
    const store = indexedDbStore({ factory: abortingFactory() }) as BatchStore

    await expect(store.put(batch(NOW))).rejects.toThrow('the browser ran out of room')
  })
})

describe('what the store is allowed to hold', () => {
  it('never holds the api key, because it is written to disk', async () => {
    const store = memoryBatchStore()

    await store.put(batch(1))
    const rows = await store.list()

    expect(Object.keys(rows[0] as StoredBatch).sort()).toEqual(['at', 'body', 'id', 'url'])
  })
})
