import { describe, expect, it } from 'vitest'
import {
  EXPORT_FORMATS,
  EXPORT_LIFETIME_DAYS,
  EXPORT_STATUSES,
  type ExportStore,
} from '../export-store.ts'
import { type MemoryExport, memoryExportStore } from './memory-export-store.ts'
import { DEFAULT_STALE_AFTER_MS, sqlExportStore } from './sql-export-store.ts'

const NOW = Date.UTC(2026, 10, 4, 12, 0, 0, 0)
const DAY = 24 * 60 * 60 * 1000

function pending(id: string, overrides: Partial<MemoryExport> = {}): MemoryExport {
  return {
    id,
    projectId: 'prj_1',
    environmentId: 'env_prod',
    format: 'csv',
    query: '',
    rangeFrom: NOW - DAY,
    rangeTo: NOW,
    status: 'pending',
    expiresAt: NOW + EXPORT_LIFETIME_DAYS * DAY,
    createdAt: NOW - 1000,
    ...overrides,
  }
}

describe('the contract', () => {
  it('names the formats and statuses the database enum holds', () => {
    expect([...EXPORT_FORMATS]).toEqual(['json', 'xml', 'csv'])
    expect([...EXPORT_STATUSES]).toEqual(['pending', 'running', 'ready', 'failed', 'expired'])
    expect(EXPORT_LIFETIME_DAYS).toBe(7)
  })
})

describe('memoryExportStore', () => {
  it('claims the oldest first and marks them running', async () => {
    const store = memoryExportStore()
    store.add(pending('exp_b', { createdAt: NOW - 500 }))
    store.add(pending('exp_a', { createdAt: NOW - 5000 }))

    const claimed = await store.claim(5, NOW)

    expect(claimed.map((one) => one.id)).toEqual(['exp_a', 'exp_b'])
    expect(store.rows.get('exp_a')?.status).toBe('running')
  })

  it('never hands the same export to two runs', async () => {
    const store = memoryExportStore()
    store.add(pending('exp_a'))

    expect(await store.claim(5, NOW)).toHaveLength(1)
    expect(await store.claim(5, NOW)).toHaveLength(0)
  })

  it('takes a running export back once it is plainly stuck', async () => {
    const store = memoryExportStore()
    store.add(pending('exp_a', { status: 'running', startedAt: NOW - DEFAULT_STALE_AFTER_MS - 1 }))

    expect(await store.claim(5, NOW)).toHaveLength(1)
  })

  it('leaves a running export alone while it still might finish', async () => {
    const store = memoryExportStore()
    store.add(pending('exp_a', { status: 'running', startedAt: NOW - 1000 }))

    expect(await store.claim(5, NOW)).toHaveLength(0)
  })

  it('honours the limit it is given, and does nothing with none', async () => {
    const store = memoryExportStore()
    store.add(pending('exp_a', { createdAt: NOW - 3 }))
    store.add(pending('exp_b', { createdAt: NOW - 2 }))

    expect(await store.claim(0, NOW)).toEqual([])
    expect((await store.claim(1, NOW)).map((one) => one.id)).toEqual(['exp_a'])
  })

  it('records what the export produced when it is ready', async () => {
    const store = memoryExportStore()
    store.add(pending('exp_a'))
    await store.claim(5, NOW)

    await store.markReady('exp_a', { objectKey: 'exports/a.csv.gz', byteSize: 9, rowCount: 3 }, NOW)

    expect(store.rows.get('exp_a')).toMatchObject({
      status: 'ready',
      objectKey: 'exports/a.csv.gz',
      byteSize: 9,
      rowCount: 3,
      finishedAt: NOW,
    })
  })

  it('records why it failed, and keeps no object key', async () => {
    const store = memoryExportStore()
    store.add(pending('exp_a'))
    await store.claim(5, NOW)

    await store.markFailed('exp_a', 'ClickHouse said no', NOW)

    expect(store.rows.get('exp_a')).toMatchObject({
      status: 'failed',
      failure: 'ClickHouse said no',
    })
    expect(store.rows.get('exp_a')?.objectKey).toBeUndefined()
  })

  it('refuses to finish an export nobody claimed, so a late run cannot overwrite a newer one', async () => {
    const store = memoryExportStore()
    store.add(pending('exp_a'))

    await store.markReady('exp_a', { objectKey: 'exports/a.csv.gz', byteSize: 1, rowCount: 1 }, NOW)

    expect(store.rows.get('exp_a')?.status).toBe('pending')
  })

  it('expires what is past its date and gives back the keys to delete', async () => {
    const store = memoryExportStore()
    store.add(
      pending('exp_old', { status: 'ready', objectKey: 'exports/old.csv.gz', expiresAt: NOW - 1 }),
    )
    store.add(
      pending('exp_new', {
        status: 'ready',
        objectKey: 'exports/new.csv.gz',
        expiresAt: NOW + DAY,
      }),
    )

    expect(await store.expire(NOW, 10)).toEqual(['exports/old.csv.gz'])
    expect(store.rows.get('exp_old')?.status).toBe('expired')
    expect(store.rows.get('exp_new')?.status).toBe('ready')
  })

  it('expires nothing that never became ready', async () => {
    const store = memoryExportStore()
    store.add(pending('exp_a', { status: 'failed', expiresAt: NOW - DAY }))

    expect(await store.expire(NOW, 10)).toEqual([])
    expect(store.rows.get('exp_a')?.status).toBe('failed')
  })
})

describe('sqlExportStore', () => {
  function recorder() {
    const calls: Array<{ text: string; params: readonly unknown[] }> = []
    const rows: Array<ReadonlyArray<Record<string, unknown>>> = []
    const store: ExportStore = sqlExportStore(async (text, params) => {
      calls.push({ text, params })
      return rows.shift() ?? []
    })
    return { calls, rows, store }
  }

  it('claims with a lock that skips what another run already took', async () => {
    const { calls, store } = recorder()

    await store.claim(3, NOW)

    expect(calls[0]?.text).toContain('for update skip locked')
    expect(calls[0]?.text).toContain("status = 'running'")
    expect(calls[0]?.params[0]).toBe(3)
  })

  it('takes the oldest first, so an export cannot starve behind newer ones', async () => {
    const { calls, store } = recorder()

    await store.claim(3, NOW)

    expect(calls[0]?.text).toContain('order by created_at')
  })

  it('takes back an export whose run died, and measures that by how long it has been running', async () => {
    const { calls, store } = recorder()

    await store.claim(3, NOW)

    expect(calls[0]?.text).toContain('started_at <')
    expect(calls[0]?.params[2]).toBe(DEFAULT_STALE_AFTER_MS / 1000)
  })

  it('expires only what became ready, because nothing else has an object to delete', async () => {
    const { calls, store } = recorder()

    await store.expire(NOW, 10)

    expect(calls[0]?.text).toContain("status = 'ready'")
    expect(calls[0]?.text).toContain('expires_at <=')
  })

  it('sends every value as a parameter, never inside the statement', async () => {
    const { calls, store } = recorder()

    await store.markFailed("exp_a'; drop table exports --", "it broke'", NOW)

    expect(calls[0]?.text).not.toContain('drop table')
    expect(calls[0]?.params).toEqual([
      "exp_a'; drop table exports --",
      "it broke'",
      new Date(NOW).toISOString(),
    ])
  })

  it('only finishes an export that is running', async () => {
    const { calls, store } = recorder()

    await store.markReady('exp_a', { objectKey: 'exports/a.csv.gz', byteSize: 2, rowCount: 1 }, NOW)
    await store.markFailed('exp_a', 'no', NOW)

    for (const call of calls) {
      expect(call.text).toContain("status = 'running'")
    }
  })

  it('reads the period back as milliseconds, whatever the driver hands over', async () => {
    const { rows, store } = recorder()
    rows.push([
      {
        id: 'exp_a',
        project_id: 'prj_1',
        environment_id: 'env_prod',
        format: 'csv',
        query: '',
        range_from_ms: '1762214400000',
        range_to_ms: 1762300800000,
      },
    ])

    const [claimed] = await store.claim(1, NOW)

    expect(claimed?.rangeFrom).toBe(1762214400000)
    expect(claimed?.rangeTo).toBe(1762300800000)
  })

  it('refuses a row whose period is not a number rather than exporting the epoch', async () => {
    const { rows, store } = recorder()
    rows.push([
      {
        id: 'exp_a',
        project_id: 'prj_1',
        environment_id: 'env_prod',
        format: 'csv',
        query: '',
        range_from_ms: null,
        range_to_ms: 1,
      },
    ])

    await expect(store.claim(1, NOW)).rejects.toThrow(/where a number belongs/)
  })

  it('asks the database for nothing at all when there is no room to claim', async () => {
    const { calls, store } = recorder()

    expect(await store.claim(0, NOW)).toEqual([])
    expect(await store.expire(NOW, 0)).toEqual([])
    expect(calls).toEqual([])
  })

  it('drops a null object key from the list of things to delete', async () => {
    const { rows, store } = recorder()
    rows.push([{ object_key: 'exports/a.csv.gz' }, { object_key: null }, { object_key: '' }])

    expect(await store.expire(NOW, 10)).toEqual(['exports/a.csv.gz'])
  })
})
