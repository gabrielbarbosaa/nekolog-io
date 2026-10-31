import {
  type LogStore,
  type LogStoreInsertOptions,
  type MemoryBlobStore,
  memoryBlobStore,
} from '@internal/adapters'
import {
  encodeSpoolEnvelope,
  QUARANTINE_PREFIX,
  SPOOL_PREFIX,
  type SpoolRow,
  spoolKey,
} from '@internal/spool'
import { describe, expect, it } from 'vitest'
import { runDueTasks } from '../run.ts'
import {
  DEFAULT_MAX_AGE_MS,
  isPermanentInsertError,
  type SpoolResendEvent,
  type SpoolResendReport,
  spoolResendTask,
} from './spool-resend.ts'

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0)
const IDS = [
  '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10',
  '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b11',
  '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b12',
] as const

async function spooled(
  store: MemoryBlobStore,
  at: number,
  batchId: string,
  rows: SpoolRow[] = [{ project_id: 'p_1', message: 'hello' }],
): Promise<string> {
  const key = spoolKey(at, batchId)
  await store.put(
    key,
    encodeSpoolEnvelope({
      spooledAt: at,
      batchId,
      projectId: 'p_1',
      environmentId: 'e_1',
      deduplicationToken: `e_1:${batchId}`,
      rows,
    }),
  )
  return key
}

type Insert = { rows: ReadonlyArray<SpoolRow>; options?: LogStoreInsertOptions }

function store(behaviour: (call: number) => Promise<void> = async () => undefined) {
  const inserts: Insert[] = []
  const logStore: LogStore = {
    async insert(rows, options) {
      inserts.push({ rows, options })
      await behaviour(inserts.length)
      return { accepted: rows.length }
    },
  }
  return { logStore, inserts }
}

function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status })
}

function run(task: ReturnType<typeof spoolResendTask>, signal = new AbortController().signal) {
  return task.run({ scheduledAt: NOW, cron: '* * * * *', signal }) as Promise<SpoolResendReport>
}

describe('isPermanentInsertError', () => {
  it('treats a 400 as permanent: the same bytes will never be accepted', () => {
    expect(isPermanentInsertError(httpError(400, 'Unknown field found'))).toBe(true)
  })

  it.each([403, 429, 500, 502, 503])('keeps retrying after a %s', (status) => {
    expect(isPermanentInsertError(httpError(status, 'later'))).toBe(false)
  })

  it('keeps retrying after an error with no status at all', () => {
    expect(isPermanentInsertError(new Error('fetch failed'))).toBe(false)
    expect(isPermanentInsertError(null)).toBe(false)
  })
})

describe('the spool resend task', () => {
  it('resends with the stored token and then forgets the file', async () => {
    const spool = memoryBlobStore()
    const key = await spooled(spool, NOW - 60_000, IDS[0])
    const { logStore, inserts } = store()

    const report = await run(spoolResendTask({ spool, logStore, now: () => NOW }))

    expect(inserts[0]?.options).toEqual({ deduplicationToken: `e_1:${IDS[0]}` })
    expect(report).toMatchObject({ resent: 1, rows: 1, quarantined: 0, stopped: 'finished' })
    expect(await spool.get(key)).toBeNull()
  })

  it('takes the oldest first', async () => {
    const spool = memoryBlobStore()
    await spooled(spool, NOW - 1_000, IDS[1])
    await spooled(spool, NOW - 60_000, IDS[0])
    const { logStore, inserts } = store()

    await run(spoolResendTask({ spool, logStore, now: () => NOW }))

    expect(inserts.map((insert) => insert.options?.deduplicationToken)).toEqual([
      `e_1:${IDS[0]}`,
      `e_1:${IDS[1]}`,
    ])
  })

  it('stops at the first file ClickHouse could not take, and keeps every file', async () => {
    const spool = memoryBlobStore()
    await spooled(spool, NOW - 3_000, IDS[0])
    await spooled(spool, NOW - 2_000, IDS[1])
    await spooled(spool, NOW - 1_000, IDS[2])
    const { logStore, inserts } = store(async () => {
      throw httpError(502, 'Bad gateway from the tunnel')
    })

    const report = await run(spoolResendTask({ spool, logStore, now: () => NOW }))

    expect(inserts).toHaveLength(1)
    expect(report).toMatchObject({ resent: 0, stopped: 'clickhouse_down' })
    expect(await spool.list(SPOOL_PREFIX)).toHaveLength(3)
  })

  it('keeps going past a file ClickHouse will never accept, and quarantines it', async () => {
    const spool = memoryBlobStore()
    const poison = await spooled(spool, NOW - 3_000, IDS[0])
    await spooled(spool, NOW - 2_000, IDS[1])
    const { logStore } = store(async (call) => {
      if (call === 1) {
        throw httpError(400, 'Unknown field found while parsing JSONEachRow')
      }
    })

    const report = await run(spoolResendTask({ spool, logStore, now: () => NOW }))

    expect(report).toMatchObject({ resent: 1, quarantined: 1, stopped: 'finished' })
    expect(await spool.list(SPOOL_PREFIX)).toEqual([])
    expect(await spool.list(QUARANTINE_PREFIX)).toHaveLength(1)
    expect(await spool.get(poison)).toBeNull()
  })

  it('quarantines a file it cannot read instead of retrying it forever', async () => {
    const spool = memoryBlobStore()
    await spool.put(spoolKey(NOW - 1_000, IDS[0]), 'this is not JSON')
    const { logStore, inserts } = store()

    const report = await run(spoolResendTask({ spool, logStore, now: () => NOW }))

    expect(inserts).toEqual([])
    expect(report).toMatchObject({ quarantined: 1 })
    expect(await spool.list(QUARANTINE_PREFIX)).toHaveLength(1)
  })

  it('quarantines a key that is not a spool key', async () => {
    const spool = memoryBlobStore({ 'spool/stray-file.json': '{}' })
    const { logStore } = store()

    const report = await run(spoolResendTask({ spool, logStore, now: () => NOW }))

    expect(report).toMatchObject({ quarantined: 1 })
    expect(await spool.list(QUARANTINE_PREFIX)).toEqual(['quarantine/stray-file.json'])
  })

  it('quarantines a batch older than the retention window without trying it', async () => {
    const spool = memoryBlobStore()
    await spooled(spool, NOW - DEFAULT_MAX_AGE_MS - 1, IDS[0])
    const { logStore, inserts } = store()

    const report = await run(spoolResendTask({ spool, logStore, now: () => NOW }))

    expect(inserts).toEqual([])
    expect(report).toMatchObject({ quarantined: 1 })
  })

  it('leaves the file alone when the quarantine copy fails', async () => {
    const key = spoolKey(NOW - 1_000, IDS[0])
    const inner = memoryBlobStore({ [key]: 'not JSON' })
    const spool = {
      ...inner,
      put: async (target: string, body: Uint8Array | string) => {
        if (target.startsWith(QUARANTINE_PREFIX)) {
          throw new Error('R2 is unreachable')
        }
        return inner.put(target, body)
      },
    }
    const { logStore } = store()

    const report = await run(spoolResendTask({ spool, logStore, now: () => NOW }))

    expect(report).toMatchObject({ quarantined: 0 })
    expect(await inner.get(key)).not.toBeNull()
  })

  it('counts a file it could not delete, which the token makes harmless', async () => {
    const key = spoolKey(NOW - 1_000, IDS[0])
    const inner = memoryBlobStore()
    await spooled(inner, NOW - 1_000, IDS[0])
    const spool = {
      ...inner,
      delete: async () => {
        throw new Error('R2 refused the delete')
      },
    }
    const { logStore } = store()
    const events: SpoolResendEvent[] = []

    const report = await run(
      spoolResendTask({ spool, logStore, now: () => NOW, onEvent: (e) => events.push(e) }),
    )

    expect(report).toMatchObject({ resent: 1, undeleted: 1 })
    expect(await inner.get(key)).not.toBeNull()
    expect(events.some((event) => event.kind === 'undeleted')).toBe(true)
  })

  it('takes no more files than its share of the tick', async () => {
    const spool = memoryBlobStore()
    await spooled(spool, NOW - 3_000, IDS[0])
    await spooled(spool, NOW - 2_000, IDS[1])
    await spooled(spool, NOW - 1_000, IDS[2])
    const { logStore, inserts } = store()

    const report = await run(spoolResendTask({ spool, logStore, filesPerRun: 2, now: () => NOW }))

    expect(inserts).toHaveLength(2)
    expect(report).toMatchObject({ resent: 2 })
    expect(await spool.list(SPOOL_PREFIX)).toHaveLength(1)
  })

  it('gives up mid sweep when the tick runs out of time', async () => {
    const spool = memoryBlobStore()
    await spooled(spool, NOW - 2_000, IDS[0])
    await spooled(spool, NOW - 1_000, IDS[1])
    const controller = new AbortController()
    const { logStore, inserts } = store(async () => {
      controller.abort()
    })

    const report = await run(
      spoolResendTask({ spool, logStore, now: () => NOW }),
      controller.signal,
    )

    expect(inserts).toHaveLength(1)
    expect(report).toMatchObject({ resent: 1, stopped: 'out_of_time' })
  })

  it('does nothing when the spool is empty', async () => {
    const { logStore, inserts } = store()

    const report = await run(
      spoolResendTask({ spool: memoryBlobStore(), logStore, now: () => NOW }),
    )

    expect(inserts).toEqual([])
    expect(report).toEqual({
      resent: 0,
      rows: 0,
      quarantined: 0,
      undeleted: 0,
      stopped: 'finished',
    })
  })

  it('reaches the run summary as the task detail', async () => {
    const spool = memoryBlobStore()
    await spooled(spool, NOW - 1_000, IDS[0])
    const { logStore } = store()

    const summary = await runDueTasks([spoolResendTask({ spool, logStore, now: () => NOW })], {
      scheduledAt: NOW,
    })

    expect(summary.ran[0]).toMatchObject({
      name: 'spool-resend',
      status: 'ok',
      detail: { resent: 1, rows: 1 },
    })
  })
})
