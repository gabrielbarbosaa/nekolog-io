import { gunzipSync } from 'node:zlib'
import {
  type BlobStore,
  EXPORT_LIFETIME_DAYS,
  type MemoryExport,
  memoryExportStore,
} from '@nekolog-io/adapters'
import { describe, expect, it, vi } from 'vitest'
import type { TaskContext } from '../task.ts'
import {
  EMPTY_GZIP,
  type ExportRunEvent,
  type ExportRunReport,
  exportRunTask,
  MAX_FAILURE_CHARS,
  reasonFrom,
} from './export-run.ts'

const NOW = Date.UTC(2026, 10, 4, 12, 0, 0)
const DAY = 24 * 60 * 60 * 1000

const SECRET = 'b0e7a4c21d8f5639ae0c47b2f81d3a69'
const ACCESS_KEY = 'GK31c2f218a2e44f485b94239e'

const DESTINATION = {
  endpoint: 'https://account.r2.cloudflarestorage.com/nekolog-exports',
  accessKeyId: ACCESS_KEY,
  secretAccessKey: SECRET,
}

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

function memoryObjects(): BlobStore & { put: ReturnType<typeof vi.fn> } {
  const kept = new Map<string, Uint8Array>()
  const put = vi.fn(async (key: string, body: Uint8Array | string) => {
    kept.set(key, typeof body === 'string' ? new TextEncoder().encode(body) : body)
  })
  return {
    put,
    async get(key) {
      return kept.get(key) ?? null
    },
    async delete(key) {
      kept.delete(key)
    },
    async list(prefix) {
      return [...kept.keys()].filter((key) => key.startsWith(prefix))
    },
  }
}

function context(overrides: Partial<TaskContext> = {}): TaskContext {
  return {
    scheduledAt: NOW,
    signal: new AbortController().signal,
    ...overrides,
  } as TaskContext
}

type Harness = {
  statements: Array<{ sql: string; params: Record<string, string> }>
  events: ExportRunEvent[]
  objects: ReturnType<typeof memoryObjects>
  store: ReturnType<typeof memoryExportStore>
  run: (overrides?: Partial<TaskContext>) => Promise<ExportRunReport>
}

function harness(
  write: (sql: string, params: Record<string, string>) => Promise<{ rows: number; bytes: number }>,
): Harness {
  const statements: Array<{ sql: string; params: Record<string, string> }> = []
  const events: ExportRunEvent[] = []
  const objects = memoryObjects()
  const store = memoryExportStore()

  const task = exportRunTask({
    exports: store,
    destination: DESTINATION,
    database: 'nekolog_dev',
    objects,
    now: () => NOW,
    onEvent: (event) => events.push(event),
    write: async (sql, params) => {
      statements.push({ sql, params })
      return write(sql, params)
    },
  })

  return {
    statements,
    events,
    objects,
    store,
    run: async (overrides = {}) => (await task.run(context(overrides))) as ExportRunReport,
  }
}

describe('the empty file it falls back to', () => {
  it('is a gzip member that really unpacks to nothing', () => {
    expect(EMPTY_GZIP.subarray(0, 2)).toEqual(new Uint8Array([0x1f, 0x8b]))
    expect(gunzipSync(EMPTY_GZIP)).toEqual(Buffer.alloc(0))
  })
})

describe('reasonFrom', () => {
  it('takes the secret out of whatever the database echoed back', () => {
    const reason = reasonFrom(new Error(`failed near '${SECRET}' and '${ACCESS_KEY}'`), [
      SECRET,
      ACCESS_KEY,
    ])

    expect(reason).not.toContain(SECRET)
    expect(reason).not.toContain(ACCESS_KEY)
    expect(reason).toContain('[redacted]')
  })

  it('keeps the part of the message that is worth reading', () => {
    expect(reasonFrom(new Error('ClickHouse: table is read only'), [SECRET])).toBe(
      'ClickHouse: table is read only',
    )
  })

  it('refuses to write a novel into the row', () => {
    expect(reasonFrom(new Error('x'.repeat(5000)), [])).toHaveLength(MAX_FAILURE_CHARS)
  })

  it('survives something thrown that was never an Error', () => {
    expect(reasonFrom('plain string', [])).toBe('plain string')
  })
})

describe('the export task', () => {
  it('claims an export, runs it and records what it produced', async () => {
    const one = harness(async () => ({ rows: 42, bytes: 900 }))
    one.store.add(pending('exp_01JBQ8R4T7V2WXYZ0123456789'))

    const report = await one.run()

    expect(report).toMatchObject({ claimed: 1, ready: 1, failed: 0 })
    expect(one.store.rows.get('exp_01JBQ8R4T7V2WXYZ0123456789')).toMatchObject({
      status: 'ready',
      rowCount: 42,
      byteSize: 900,
      objectKey: 'exports/exp_01JBQ8R4T7V2WXYZ0123456789.csv.gz',
    })
  })

  it('sends the period and the project as bound parameters, never inside the statement', async () => {
    const one = harness(async () => ({ rows: 1, bytes: 1 }))
    one.store.add(pending('exp_01JBQ8R4T7V2WXYZ0123456789'))

    await one.run()

    const sent = one.statements[0]
    expect(Object.values(sent?.params ?? {})).toContain('prj_1')
    expect(Object.values(sent?.params ?? {})).toContain('env_prod')
    expect(sent?.sql).not.toContain('prj_1')
  })

  it('writes an empty gzip when the export matched nothing, because ClickHouse writes no object', async () => {
    const one = harness(async () => ({ rows: 0, bytes: 0 }))
    one.store.add(pending('exp_01JBQ8R4T7V2WXYZ0123456789'))

    const report = await one.run()

    expect(report).toMatchObject({ ready: 1, failed: 0 })
    expect(one.objects.put).toHaveBeenCalledWith(
      'exports/exp_01JBQ8R4T7V2WXYZ0123456789.csv.gz',
      EMPTY_GZIP,
      'application/gzip',
    )
    expect(await one.objects.get('exports/exp_01JBQ8R4T7V2WXYZ0123456789.csv.gz')).not.toBeNull()
  })

  it('leaves the object alone when ClickHouse did write one', async () => {
    const one = harness(async () => ({ rows: 3, bytes: 90 }))
    one.store.add(pending('exp_01JBQ8R4T7V2WXYZ0123456789'))

    await one.run()

    expect(one.objects.put).not.toHaveBeenCalled()
  })

  it('records a failure without ever writing the credentials into the row', async () => {
    const one = harness(async (sql) => {
      throw new Error(`ClickHouse refused: ${sql}`)
    })
    one.store.add(pending('exp_01JBQ8R4T7V2WXYZ0123456789'))

    const report = await one.run()
    const row = one.store.rows.get('exp_01JBQ8R4T7V2WXYZ0123456789')

    expect(report).toMatchObject({ ready: 0, failed: 1 })
    expect(row?.status).toBe('failed')
    expect(row?.failure).not.toContain(SECRET)
    expect(row?.failure).not.toContain(ACCESS_KEY)
  })

  it('fails the one export that broke and still runs the next', async () => {
    let call = 0
    const one = harness(async () => {
      call += 1
      if (call === 1) {
        throw new Error('nope')
      }
      return { rows: 1, bytes: 1 }
    })
    one.store.add(pending('exp_01JBQ8R4T7V2WXYZ0123456781', { createdAt: NOW - 9000 }))
    one.store.add(pending('exp_01JBQ8R4T7V2WXYZ0123456782', { createdAt: NOW - 1000 }))

    const report = await one.run()

    expect(report).toMatchObject({ claimed: 2, ready: 1, failed: 1 })
  })

  it('fails an export whose stored period is impossible, instead of running it', async () => {
    const one = harness(async () => ({ rows: 1, bytes: 1 }))
    one.store.add(pending('exp_01JBQ8R4T7V2WXYZ0123456789', { rangeFrom: NOW, rangeTo: NOW - DAY }))

    const report = await one.run()

    expect(report).toMatchObject({ failed: 1, ready: 0 })
    expect(one.statements).toEqual([])
    expect(one.store.rows.get('exp_01JBQ8R4T7V2WXYZ0123456789')?.failure).toMatch(/Refusing/)
  })

  it('does nothing at all when there is nothing waiting', async () => {
    const one = harness(async () => ({ rows: 1, bytes: 1 }))

    expect(await one.run()).toMatchObject({ claimed: 0, ready: 0, failed: 0, expired: 0 })
    expect(one.statements).toEqual([])
  })

  it('stops when the deadline passed rather than starting another export', async () => {
    const controller = new AbortController()
    controller.abort()
    const one = harness(async () => ({ rows: 1, bytes: 1 }))
    one.store.add(pending('exp_01JBQ8R4T7V2WXYZ0123456789'))

    const report = await one.run({ signal: controller.signal })

    expect(report.stopped).toBe('out_of_time')
    expect(one.statements).toEqual([])
  })

  it('says so rather than guessing when the store cannot be reached', async () => {
    const task = exportRunTask({
      exports: {
        claim: async () => {
          throw new Error('postgres is asleep')
        },
        markReady: async () => {},
        markFailed: async () => {},
        expire: async () => [],
        awaitingNotice: async () => [],
        markNotified: async () => {},
      },
      write: async () => ({ rows: 1, bytes: 1 }),
      destination: DESTINATION,
      database: 'nekolog_dev',
    })

    expect(await task.run(context())).toMatchObject({ stopped: 'store_unavailable', claimed: 0 })
  })

  it('deletes the object of an export that has expired', async () => {
    const one = harness(async () => ({ rows: 1, bytes: 1 }))
    one.store.add(
      pending('exp_01JBQ8R4T7V2WXYZ0123456789', {
        status: 'ready',
        objectKey: 'exports/old.csv.gz',
        expiresAt: NOW - 1,
      }),
    )
    await one.objects.put('exports/old.csv.gz', EMPTY_GZIP)

    const report = await one.run()

    expect(report.expired).toBe(1)
    expect(await one.objects.get('exports/old.csv.gz')).toBeNull()
    expect(one.events).toContainEqual({
      kind: 'expired',
      objectKey: 'exports/old.csv.gz',
      deleted: true,
    })
  })

  it('still marks the export expired when the bucket refuses the delete', async () => {
    const one = harness(async () => ({ rows: 1, bytes: 1 }))
    one.objects.delete = async () => {
      throw new Error('R2 is down')
    }
    one.store.add(
      pending('exp_01JBQ8R4T7V2WXYZ0123456789', {
        status: 'ready',
        objectKey: 'exports/old.csv.gz',
        expiresAt: NOW - 1,
      }),
    )

    const report = await one.run()

    expect(report.expired).toBe(1)
    expect(one.store.rows.get('exp_01JBQ8R4T7V2WXYZ0123456789')?.status).toBe('expired')
    expect(one.events).toContainEqual({
      kind: 'expired',
      objectKey: 'exports/old.csv.gz',
      deleted: false,
    })
  })

  it('refuses to call an empty export ready when it has nowhere to put the empty file', async () => {
    const store = memoryExportStore()
    store.add(pending('exp_01JBQ8R4T7V2WXYZ0123456789'))
    const task = exportRunTask({
      exports: store,
      write: async () => ({ rows: 0, bytes: 0 }),
      destination: DESTINATION,
      database: 'nekolog_dev',
      now: () => NOW,
    })

    const report = (await task.run(context())) as ExportRunReport

    expect(report).toMatchObject({ ready: 0, failed: 1 })
    expect(store.rows.get('exp_01JBQ8R4T7V2WXYZ0123456789')?.status).toBe('failed')
  })
})
