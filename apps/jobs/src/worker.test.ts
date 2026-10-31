import { describe, expect, it, vi } from 'vitest'
import type { RunSummary } from './run.ts'
import type { Task } from './task.ts'
import worker, {
  assertEnv,
  assertNoFailures,
  buildJobTasks,
  type JobsEnv,
  runScheduled,
  writeSpoolEvent,
  writeSummary,
} from './worker.ts'

const ENV: JobsEnv = {
  SPOOL: {
    async put() {
      return undefined
    },
    async get() {
      return null
    },
    async delete() {},
    async list() {
      return { objects: [], truncated: false }
    },
  },
  CLICKHOUSE_URL: 'http://clickhouse.test:8123',
  CLICKHOUSE_DB: 'nekolog_dev',
  CLICKHOUSE_JOBS_USER: 'nekolog_jobs',
  CLICKHOUSE_JOBS_PASSWORD: 'secret',
}

const EVENT = { cron: '* * * * *', scheduledTime: Date.UTC(2026, 9, 31, 12, 0, 0) }

function context() {
  const deferred: Array<Promise<unknown>> = []
  return {
    deferred,
    ctx: {
      waitUntil: (work: Promise<unknown>) => {
        deferred.push(work)
      },
    },
  }
}

function summary(partial: Partial<RunSummary> = {}): RunSummary {
  return {
    cron: '* * * * *',
    scheduledAt: EVENT.scheduledTime,
    durationMs: 1,
    ran: [],
    skipped: [],
    failed: 0,
    ...partial,
  }
}

describe('assertNoFailures', () => {
  it('lets a clean run through', () => {
    const clean = summary({ ran: [{ name: 'a', status: 'ok', durationMs: 1 }] })

    expect(assertNoFailures(clean)).toBe(clean)
  })

  it('names what broke, so the cron shows red instead of silently green', () => {
    expect(() =>
      assertNoFailures(
        summary({
          failed: 2,
          ran: [
            { name: 'a', status: 'ok', durationMs: 1 },
            { name: 'quotas', status: 'failed', durationMs: 2 },
            { name: 'spool', status: 'timed_out', durationMs: 3 },
          ],
        }),
      ),
    ).toThrow('Scheduled tasks did not finish: quotas (failed), spool (timed_out)')
  })
})

describe('runScheduled', () => {
  it('turns the cron event into a run of the due tasks', async () => {
    const seen: Array<{ scheduledAt: number; cron: string }> = []
    const tasks: Task[] = [
      {
        name: 'a',
        everyMinutes: 1,
        run: (c) => seen.push({ scheduledAt: c.scheduledAt, cron: c.cron }),
      },
    ]
    const reported: RunSummary[] = []

    const result = await runScheduled(EVENT, { tasks, onSummary: (s) => reported.push(s) })

    expect(seen).toEqual([{ scheduledAt: EVENT.scheduledTime, cron: '* * * * *' }])
    expect(result.failed).toBe(0)
    expect(reported).toHaveLength(1)
  })

  it('reports the summary before it throws, so the failure is still readable', async () => {
    const reported: RunSummary[] = []
    const tasks: Task[] = [
      {
        name: 'broken',
        everyMinutes: 1,
        run: () => {
          throw new Error('nope')
        },
      },
    ]

    await expect(
      runScheduled(EVENT, { tasks, onSummary: (s) => reported.push(s) }),
    ).rejects.toThrow(/broken \(failed\)/)
    expect(reported[0]?.ran[0]).toMatchObject({ name: 'broken', status: 'failed' })
  })
})

describe('writeSummary', () => {
  it('writes one JSON line tagged with the app', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    writeSummary(summary({ failed: 1 }))

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      app: 'nekolog/jobs',
      failed: 1,
    })
    log.mockRestore()
  })

  it('stays quiet when there is no console to write to', () => {
    const original = globalThis.console
    Object.defineProperty(globalThis, 'console', { value: undefined, configurable: true })

    try {
      expect(() => writeSummary(summary())).not.toThrow()
    } finally {
      Object.defineProperty(globalThis, 'console', { value: original, configurable: true })
    }
  })
})

describe('writeSpoolEvent', () => {
  it('warns about a file that did not go through', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    writeSpoolEvent({ kind: 'quarantined', key: 'spool/a.json', why: 'not JSON' })

    expect(String(warn.mock.calls[0]?.[1])).toContain('quarantined')
    warn.mockRestore()
  })

  it('stays silent on the normal case, which happens every minute', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    writeSpoolEvent({ kind: 'resent', key: 'spool/a.json', rows: 3 })

    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('assertEnv', () => {
  it('accepts a complete environment', () => {
    expect(assertEnv(ENV)).toBe(ENV)
  })

  it.each([
    'SPOOL',
    'CLICKHOUSE_URL',
    'CLICKHOUSE_DB',
    'CLICKHOUSE_JOBS_USER',
    'CLICKHOUSE_JOBS_PASSWORD',
  ] as const)('refuses an environment missing %s, and says which', (name) => {
    expect(() => assertEnv({ ...ENV, [name]: undefined })).toThrow(new RegExp(name))
  })

  it('names every missing binding at once, not just the first', () => {
    expect(() => assertEnv({})).toThrow(/SPOOL.*CLICKHOUSE_URL/)
  })
})

describe('buildJobTasks', () => {
  it('registers the spool resend, which runs every minute', () => {
    const tasks = buildJobTasks(ENV)

    expect(tasks.map((task) => task.name)).toEqual(['spool-resend'])
    expect(tasks[0]?.everyMinutes).toBe(1)
  })
})

describe('the worker entry', () => {
  it('serves /health over fetch', async () => {
    const response = await worker.fetch(
      new Request('http://jobs.test/health'),
      { ...ENV, JOBS_VERSION: '1.2.3' },
      context().ctx,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ service: 'jobs', version: '1.2.3', tasks: 1 })
  })

  it('keeps the cron alive with waitUntil and returns the same promise', async () => {
    const { ctx, deferred } = context()
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    const work = worker.scheduled(EVENT, ENV, ctx)

    expect(deferred).toHaveLength(1)
    expect(deferred[0]).toBe(work)
    await expect(work).resolves.toMatchObject({ failed: 0 })
    log.mockRestore()
  })
})
