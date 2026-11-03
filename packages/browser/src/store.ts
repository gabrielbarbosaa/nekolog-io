export const DATABASE_NAME = 'nekolog'
export const STORE_NAME = 'batches'
export const DATABASE_VERSION = 1
export const AGE_INDEX = 'at'

export const DEFAULT_MAX_STORED_BATCHES = 50
export const DEFAULT_MAX_STORED_BYTES: number = 2 * 1024 * 1024
export const DEFAULT_MAX_AGE_MS: number = 7 * 24 * 60 * 60 * 1000

export type PendingBatch = {
  at: number
  url: string
  body: string
}

export type StoredBatch = PendingBatch & { id: number }

export type PruneOptions = {
  now?: number
  maxBatches?: number
  maxBytes?: number
  maxAgeMs?: number
}

export type BatchStore = {
  put(batch: PendingBatch): Promise<void>
  list(limit?: number): Promise<StoredBatch[]>
  remove(id: number): Promise<void>
  prune(options?: PruneOptions): Promise<number>
  clear(): Promise<void>
}

export function doomed(batches: readonly StoredBatch[], options: PruneOptions = {}): number[] {
  const now = options.now ?? Date.now()
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  const maxBatches = options.maxBatches ?? DEFAULT_MAX_STORED_BATCHES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_STORED_BYTES

  const ordered = [...batches].sort((left, right) => left.at - right.at || left.id - right.id)
  const stale = new Set(
    ordered.filter((batch) => now - batch.at > maxAgeMs).map((batch) => batch.id),
  )

  const kept: StoredBatch[] = []
  let bytes = 0
  for (let index = ordered.length - 1; index >= 0; index--) {
    const batch = ordered[index] as StoredBatch
    if (stale.has(batch.id)) {
      continue
    }
    const size = batch.body.length
    if (kept.length >= maxBatches || bytes + size > maxBytes) {
      stale.add(batch.id)
      continue
    }
    kept.push(batch)
    bytes += size
  }

  return ordered.filter((batch) => stale.has(batch.id)).map((batch) => batch.id)
}

export function memoryBatchStore(): BatchStore {
  let next = 1
  let rows: StoredBatch[] = []

  return {
    put(batch) {
      rows.push({ ...batch, id: next })
      next += 1
      return Promise.resolve()
    },
    list(limit) {
      const ordered = [...rows].sort((left, right) => left.at - right.at || left.id - right.id)
      return Promise.resolve(limit === undefined ? ordered : ordered.slice(0, limit))
    },
    remove(id) {
      rows = rows.filter((row) => row.id !== id)
      return Promise.resolve()
    },
    async prune(options) {
      const gone = new Set(doomed(await this.list(), options))
      rows = rows.filter((row) => !gone.has(row.id))
      return gone.size
    },
    clear() {
      rows = []
      return Promise.resolve()
    },
  }
}

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB refused the request'))
  })
}

function globalFactory(): IDBFactory | undefined {
  return (globalThis as { indexedDB?: IDBFactory }).indexedDB
}

export type IndexedDbOptions = {
  factory?: IDBFactory
  name?: string
}

export function indexedDbStore(options: IndexedDbOptions = {}): BatchStore | undefined {
  const factory = options.factory ?? globalFactory()
  if (factory === undefined) {
    return undefined
  }

  const name = options.name ?? DATABASE_NAME
  let opening: Promise<IDBDatabase> | undefined

  const open = (): Promise<IDBDatabase> => {
    if (opening === undefined) {
      opening = new Promise<IDBDatabase>((resolve, reject) => {
        const request = factory.open(name, DATABASE_VERSION)
        request.onupgradeneeded = () => {
          const database = request.result
          if (!database.objectStoreNames.contains(STORE_NAME)) {
            const store = database.createObjectStore(STORE_NAME, {
              keyPath: 'id',
              autoIncrement: true,
            })
            store.createIndex(AGE_INDEX, 'at')
          }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB would not open'))
      }).catch((error: unknown) => {
        opening = undefined
        throw error
      })
    }
    return opening
  }

  const within = async <T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> => {
    const database = await open()
    const transaction = database.transaction(STORE_NAME, mode)
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('IndexedDB gave the transaction up'))
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('IndexedDB refused the transaction'))
    })
    const result = await work(transaction.objectStore(STORE_NAME))
    await done
    return result
  }

  const store: BatchStore = {
    async put(batch) {
      await within('readwrite', async (objects) => {
        await settled(objects.add({ ...batch }))
      })
    },
    async list(limit) {
      const rows = await within('readonly', (objects) => settled(objects.index(AGE_INDEX).getAll()))
      const ordered = rows as StoredBatch[]
      return limit === undefined ? ordered : ordered.slice(0, limit)
    },
    async remove(id) {
      await within('readwrite', async (objects) => {
        await settled(objects.delete(id))
      })
    },
    async prune(options) {
      const gone = doomed(await store.list(), options)
      if (gone.length > 0) {
        await within('readwrite', async (objects) => {
          for (const id of gone) {
            await settled(objects.delete(id))
          }
        })
      }
      return gone.length
    },
    async clear() {
      await within('readwrite', async (objects) => {
        await settled(objects.clear())
      })
    },
  }

  return store
}
