import type { KeyDirectory, KeyRecord, KvNamespace, PublishedKey } from '@nekolog-io/adapters'
import { KEY_INDEX_KEY, kvKeyFor, readKeyIndex } from '@nekolog-io/adapters'
import { describe, expect, it } from 'vitest'
import type { TaskContext } from '../task.ts'
import { KEY_SYNC_TASK, type KeySyncEvent, type KeySyncReport, keySyncTask } from './key-sync.ts'

const NOON = Date.UTC(2026, 10, 6, 12, 0, 0)

const RECORD: KeyRecord = {
  projectId: 'prj_1',
  environmentId: 'env_1',
  keyId: 'key_1',
  scopes: ['logs:write'],
  originAllowlist: null,
  blocked: false,
  retentionDays: 7,
  minLevel: 'trace',
  sampleRate: 1,
}

function fakeKv(): { namespace: KvNamespace; store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    namespace: {
      async get(key) {
        return store.get(key) ?? null
      },
      async put(key, value) {
        store.set(key, value)
      },
      async delete(key) {
        store.delete(key)
      },
    },
  }
}

function directoryOf(...keys: PublishedKey[]): KeyDirectory {
  return {
    async live() {
      return keys
    },
    async stampLastUsed() {
      return 0
    },
  }
}

function brokenDirectory(): KeyDirectory {
  return {
    async live() {
      throw new Error('Postgres is unreachable')
    },
    async stampLastUsed() {
      return 0
    },
  }
}

function context(overrides: Partial<TaskContext> = {}): TaskContext {
  return {
    scheduledAt: NOON,
    cron: '* * * * *',
    signal: new AbortController().signal,
    ...overrides,
  }
}

async function run(
  task: ReturnType<typeof keySyncTask>,
  overrides: Partial<TaskContext> = {},
): Promise<KeySyncReport> {
  return (await task.run(context(overrides))) as KeySyncReport
}

describe('the task that carries the database into the KV', () => {
  it('runs every minute, which is the ~60 s the plan promises a revocation', () => {
    expect(keySyncTask({ directory: directoryOf(), kv: fakeKv().namespace }).everyMinutes).toBe(1)
    expect(keySyncTask({ directory: directoryOf(), kv: fakeKv().namespace }).name).toBe(
      KEY_SYNC_TASK,
    )
  })

  it('publishes a live key and records what it wrote', async () => {
    const kv = fakeKv()
    const report = await run(
      keySyncTask({ directory: directoryOf({ keyHash: 'h1', record: RECORD }), kv: kv.namespace }),
    )

    expect(report).toEqual({ live: 1, written: 1, removed: 0, unchanged: 0, stopped: 'finished' })
    expect(kv.store.has(kvKeyFor('h1'))).toBe(true)
    expect(Object.keys(await readKeyIndex(kv.namespace))).toEqual(['h1'])
  })

  it('writes nothing on a second run that found the same keys', async () => {
    const kv = fakeKv()
    const task = keySyncTask({
      directory: directoryOf({ keyHash: 'h1', record: RECORD }),
      kv: kv.namespace,
    })

    await run(task)
    expect(await run(task)).toEqual({
      live: 1,
      written: 0,
      removed: 0,
      unchanged: 1,
      stopped: 'finished',
    })
  })

  it('takes a key out of the KV once the database no longer calls it live', async () => {
    const kv = fakeKv()
    await run(
      keySyncTask({ directory: directoryOf({ keyHash: 'h1', record: RECORD }), kv: kv.namespace }),
    )

    const after = await run(keySyncTask({ directory: directoryOf(), kv: kv.namespace }))

    expect(after.removed).toBe(1)
    expect(kv.store.has(kvKeyFor('h1'))).toBe(false)
  })

  it('touches nothing when it cannot read the database, rather than revoking everyone', async () => {
    const kv = fakeKv()
    await run(
      keySyncTask({ directory: directoryOf({ keyHash: 'h1', record: RECORD }), kv: kv.namespace }),
    )
    const before = new Map(kv.store)

    const report = await run(keySyncTask({ directory: brokenDirectory(), kv: kv.namespace }))

    expect(report.stopped).toBe('directory_unavailable')
    expect(report.removed).toBe(0)
    expect([...kv.store.entries()]).toEqual([...before.entries()])
  })

  it('says it could not read, because a silent key sync is a dead one', async () => {
    const seen: KeySyncEvent[] = []
    await run(
      keySyncTask({
        directory: brokenDirectory(),
        kv: fakeKv().namespace,
        onEvent: (event) => seen.push(event),
      }),
    )

    expect(seen.map((event) => event.kind)).toEqual(['unreadable'])
  })

  it('stops before writing when the run is out of time', async () => {
    const kv = fakeKv()
    const controller = new AbortController()
    controller.abort()

    const report = await run(
      keySyncTask({ directory: directoryOf({ keyHash: 'h1', record: RECORD }), kv: kv.namespace }),
      { signal: controller.signal },
    )

    expect(report.stopped).toBe('out_of_time')
    expect(kv.store.size).toBe(0)
  })

  it('reports nothing on a run that changed nothing, so the log stays readable', async () => {
    const kv = fakeKv()
    const seen: KeySyncEvent[] = []
    const task = keySyncTask({
      directory: directoryOf({ keyHash: 'h1', record: RECORD }),
      kv: kv.namespace,
      onEvent: (event) => seen.push(event),
    })

    await run(task)
    await run(task)

    expect(seen).toHaveLength(1)
  })

  it('survives a listener of its own that throws', async () => {
    const report = await run(
      keySyncTask({
        directory: directoryOf({ keyHash: 'h1', record: RECORD }),
        kv: fakeKv().namespace,
        onEvent: () => {
          throw new Error('the log is broken')
        },
      }),
    )

    expect(report.written).toBe(1)
  })

  it('keeps the index beside the keys, which is the only record of what it wrote', async () => {
    const kv = fakeKv()
    await run(
      keySyncTask({ directory: directoryOf({ keyHash: 'h1', record: RECORD }), kv: kv.namespace }),
    )

    expect(kv.store.has(KEY_INDEX_KEY)).toBe(true)
  })
})
