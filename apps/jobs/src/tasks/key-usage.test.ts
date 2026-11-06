import type { KeyDirectory, KeyUsageStamp } from '@nekolog-io/adapters'
import { describe, expect, it } from 'vitest'
import type { TaskContext } from '../task.ts'
import {
  KEY_USAGE_TASK,
  KEY_USAGE_WINDOW_MS,
  type KeyUsageReport,
  keyUsageTask,
} from './key-usage.ts'

const NOON = Date.UTC(2026, 10, 6, 12, 0, 0)

function directory(): KeyDirectory & { stamped: KeyUsageStamp[][] } {
  const stamped: KeyUsageStamp[][] = []
  return {
    stamped,
    async live() {
      return []
    },
    async stampLastUsed(stamps) {
      stamped.push([...stamps])
      return stamps.length
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
  task: ReturnType<typeof keyUsageTask>,
  overrides: Partial<TaskContext> = {},
): Promise<KeyUsageReport> {
  return (await task.run(context(overrides))) as KeyUsageReport
}

describe('the task that fills in the last use of a key', () => {
  it('is registered under its own name', () => {
    const task = keyUsageTask({ directory: directory(), read: async () => [] })

    expect(task.name).toBe(KEY_USAGE_TASK)
    expect(task.everyMinutes).toBe(5)
  })

  it('asks ClickHouse for a window that overlaps its own cadence', async () => {
    const asked: Date[] = []
    await run(
      keyUsageTask({
        directory: directory(),
        read: async (since) => {
          asked.push(since)
          return []
        },
      }),
    )

    expect(asked[0]?.getTime()).toBe(NOON - KEY_USAGE_WINDOW_MS)
    expect(
      KEY_USAGE_WINDOW_MS,
      'the window has to be wider than the gap between runs, or a key slips through',
    ).toBeGreaterThan(5 * 60 * 1000)
  })

  it('stamps what it saw', async () => {
    const store = directory()
    const at = new Date(NOON - 1000)

    const report = await run(
      keyUsageTask({ directory: store, read: async () => [{ keyId: 'key_1', at }] }),
    )

    expect(report).toEqual({ seen: 1, stamped: 1, stopped: 'finished' })
    expect(store.stamped).toEqual([[{ keyId: 'key_1', at }]])
  })

  it('drops a row with no key id, which is every row written before this column existed', async () => {
    const store = directory()

    const report = await run(
      keyUsageTask({
        directory: store,
        read: async () => [
          { keyId: '', at: new Date(NOON) },
          { keyId: 'key_1', at: new Date(NOON) },
        ],
      }),
    )

    expect(report.seen).toBe(1)
    expect(store.stamped[0]?.map((stamp) => stamp.keyId)).toEqual(['key_1'])
  })

  it('writes nothing when it cannot read, rather than clearing what is there', async () => {
    const store = directory()

    const report = await run(
      keyUsageTask({
        directory: store,
        read: async () => {
          throw new Error('ClickHouse is unreachable')
        },
      }),
    )

    expect(report.stopped).toBe('usage_unavailable')
    expect(store.stamped).toEqual([])
  })

  it('stops before writing when the run is out of time', async () => {
    const store = directory()
    const controller = new AbortController()
    controller.abort()

    const report = await run(
      keyUsageTask({ directory: store, read: async () => [{ keyId: 'key_1', at: new Date() }] }),
      { signal: controller.signal },
    )

    expect(report.stopped).toBe('out_of_time')
    expect(store.stamped).toEqual([])
  })
})
