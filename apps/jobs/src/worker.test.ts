import { describe, expect, it, vi } from 'vitest'
import type { RunSummary } from './run.ts'
import type { Task } from './task.ts'
import worker, { assertNoFailures, runScheduled, writeSummary } from './worker.ts'

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

describe('the worker entry', () => {
  it('serves /health over fetch', async () => {
    const response = await worker.fetch(
      new Request('http://jobs.test/health'),
      { JOBS_VERSION: '1.2.3' },
      context().ctx,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ service: 'jobs', version: '1.2.3' })
  })

  it('keeps the cron alive with waitUntil and returns the same promise', async () => {
    const { ctx, deferred } = context()
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    const work = worker.scheduled(EVENT, {}, ctx)

    expect(deferred).toHaveLength(1)
    expect(deferred[0]).toBe(work)
    await expect(work).resolves.toMatchObject({ ran: [], failed: 0 })
    log.mockRestore()
  })
})
