import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_ERROR_CHARS, type RunSummary, runDueTasks } from './run.ts'
import { MINUTE_MS } from './schedule.ts'
import type { Task, TaskContext } from './task.ts'

const NOON = Date.UTC(2026, 9, 31, 12, 0, 0)

function task(name: string, run: Task['run'], extra: Partial<Task> = {}): Task {
  return { name, everyMinutes: 1, run, ...extra }
}

function outcomeFor(summary: RunSummary, name: string) {
  return summary.ran.find((entry) => entry.name === name)
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('runDueTasks', () => {
  it('runs the due tasks and lists the ones it left alone', async () => {
    const calls: string[] = []
    const tasks = [
      task('every-minute', () => calls.push('every-minute')),
      task('every-five', () => calls.push('every-five'), { everyMinutes: 5, offsetMinutes: 1 }),
    ]

    const summary = await runDueTasks(tasks, { scheduledAt: NOON, cron: '* * * * *' })

    expect(calls).toEqual(['every-minute'])
    expect(summary.ran.map((entry) => entry.name)).toEqual(['every-minute'])
    expect(summary.skipped).toEqual(['every-five'])
    expect(summary.failed).toBe(0)
    expect(summary.cron).toBe('* * * * *')
    expect(summary.scheduledAt).toBe(NOON)
  })

  it('keeps going when one task throws, which is the whole point of the dispatcher', async () => {
    const tasks = [
      task('first', () => {
        throw new Error('ClickHouse is down')
      }),
      task('second', async () => 'fine'),
      task('third', () => Promise.reject(new Error('KV write refused'))),
    ]

    const summary = await runDueTasks(tasks, { scheduledAt: NOON })

    expect(outcomeFor(summary, 'first')).toMatchObject({
      status: 'failed',
      error: 'ClickHouse is down',
    })
    expect(outcomeFor(summary, 'second')).toMatchObject({ status: 'ok' })
    expect(outcomeFor(summary, 'third')).toMatchObject({
      status: 'failed',
      error: 'KV write refused',
    })
    expect(summary.failed).toBe(2)
  })

  it('never rejects, so a bad task can never kill the run', async () => {
    const summary = await runDueTasks([task('bad', () => Promise.reject('plain string'))], {
      scheduledAt: NOON,
    })

    expect(outcomeFor(summary, 'bad')).toMatchObject({ status: 'failed', error: 'plain string' })
  })

  it('runs the due tasks side by side, not one after the other', async () => {
    let releaseFirst: () => void = () => undefined
    const firstStarted = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const tasks = [
      task('waits-for-the-other', async () => {
        await firstStarted
      }),
      task('releases', () => {
        releaseFirst()
      }),
    ]

    const summary = await runDueTasks(tasks, { scheduledAt: NOON, budgetMs: 200 })

    expect(summary.ran.every((entry) => entry.status === 'ok')).toBe(true)
  })

  it('gives up on a task that never answers and aborts its signal', async () => {
    let signal: AbortSignal | undefined
    const stuck = task(
      'stuck',
      (context: TaskContext) =>
        new Promise(() => {
          signal = context.signal
        }),
      { timeoutMs: 20 },
    )

    const summary = await runDueTasks([stuck], { scheduledAt: NOON })

    expect(outcomeFor(summary, 'stuck')).toMatchObject({ status: 'timed_out' })
    expect(summary.failed).toBe(1)
    expect(signal?.aborted).toBe(true)
  })

  it('caps a task timeout at the budget left for the whole run', async () => {
    const started = Date.now()
    const stuck = task('stuck', () => new Promise(() => undefined), { timeoutMs: 10 * MINUTE_MS })

    const summary = await runDueTasks([stuck], { scheduledAt: NOON, budgetMs: 25 })

    expect(outcomeFor(summary, 'stuck')?.status).toBe('timed_out')
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('leaves no unhandled rejection behind when an abandoned task fails later', async () => {
    const seen: unknown[] = []
    const collect = (reason: unknown) => seen.push(reason)
    process.on('unhandledRejection', collect)

    try {
      const late = task(
        'late',
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error('answered after we gave up')), 30)
          }),
        { timeoutMs: 10 },
      )

      const summary = await runDueTasks([late], { scheduledAt: NOON })
      expect(outcomeFor(summary, 'late')?.status).toBe('timed_out')

      await new Promise((resolve) => setTimeout(resolve, 60))
      await tick()

      expect(seen).toEqual([])
    } finally {
      process.off('unhandledRejection', collect)
    }
  })

  it('flattens and shortens the error, because the summary is one log line', async () => {
    const summary = await runDueTasks(
      [
        task('wordy', () => {
          throw new Error(`broke\n  on ${'x'.repeat(MAX_ERROR_CHARS)}`)
        }),
      ],
      { scheduledAt: NOON },
    )

    const error = outcomeFor(summary, 'wordy')?.error ?? ''
    expect(error).not.toContain('\n')
    expect(error.startsWith('broke on ')).toBe(true)
    expect(error.length).toBeLessThanOrEqual(MAX_ERROR_CHARS + 1)
  })

  it('hands the summary over once and survives a reporter that throws', async () => {
    const onSummary = vi.fn(() => {
      throw new Error('the log sink is down')
    })

    const summary = await runDueTasks([task('ok', () => undefined)], {
      scheduledAt: NOON,
      onSummary,
    })

    expect(onSummary).toHaveBeenCalledTimes(1)
    expect(summary.failed).toBe(0)
  })

  it('reports a duration measured with the injected clock', async () => {
    let clock = 1_000
    const now = () => {
      clock += 5
      return clock
    }

    const summary = await runDueTasks([task('ok', () => undefined)], {
      scheduledAt: NOON,
      now,
    })

    expect(summary.durationMs).toBeGreaterThan(0)
    expect(outcomeFor(summary, 'ok')?.durationMs).toBeGreaterThan(0)
  })

  it('passes the scheduled time and cron down to the task', async () => {
    const seen: TaskContext[] = []

    await runDueTasks([task('reads-context', (context) => seen.push(context))], {
      scheduledAt: NOON,
      cron: '*/5 * * * *',
    })

    expect(seen[0]).toMatchObject({ scheduledAt: NOON, cron: '*/5 * * * *' })
    expect(seen[0]?.signal.aborted).toBe(false)
  })

  it('does nothing at all when no task is registered yet', async () => {
    const summary = await runDueTasks([], { scheduledAt: NOON })

    expect(summary).toMatchObject({ ran: [], skipped: [], failed: 0 })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
