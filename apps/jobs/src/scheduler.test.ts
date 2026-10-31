import { describe, expect, it, vi } from 'vitest'
import type { RunSummary } from './run.ts'
import { MINUTE_MS } from './schedule.ts'
import { gridMinute, msUntilNextMinute, startScheduler } from './scheduler.ts'
import type { Task } from './task.ts'

const NOON = Date.UTC(2026, 9, 31, 12, 0, 0)

function timerQueue() {
  const pending: Array<{ run: () => void; delayMs: number }> = []
  return {
    pending,
    setTimer: (run: () => void, delayMs: number) => {
      pending.push({ run, delayMs })
      return pending.length
    },
    clearTimer: vi.fn(),
    fire: () => {
      const next = pending.pop()
      pending.length = 0
      next?.run()
    },
  }
}

function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('msUntilNextMinute', () => {
  it('waits for the next whole minute of the clock', () => {
    expect(msUntilNextMinute(NOON + 20_000)).toBe(40_000)
    expect(msUntilNextMinute(NOON)).toBe(MINUTE_MS)
  })
})

describe('gridMinute', () => {
  it('snaps to the nearest minute, so a timer firing early keeps the right slot', () => {
    expect(gridMinute(NOON + 3)).toBe(NOON)
    expect(gridMinute(NOON - 3)).toBe(NOON)
    expect(gridMinute(NOON + 31_000)).toBe(NOON + MINUTE_MS)
  })
})

describe('startScheduler', () => {
  it('runs the due tasks on each tick and queues the next one', async () => {
    const timers = timerQueue()
    let clock = NOON - 10_000
    const ran: number[] = []
    const tasks: Task[] = [{ name: 'tick', everyMinutes: 1, run: () => ran.push(clock) }]

    const stop = startScheduler({
      tasks,
      now: () => clock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    })

    expect(timers.pending[0]?.delayMs).toBe(10_000)

    clock = NOON + 2
    timers.fire()
    await settled()

    expect(ran).toHaveLength(1)
    expect(timers.pending[0]?.delayMs).toBe(MINUTE_MS - 2)

    stop()
    expect(timers.clearTimer).toHaveBeenCalled()
  })

  it('does not start a second run while the first is still going', async () => {
    const timers = timerQueue()
    let clock = NOON
    let starts = 0
    const overlaps: number[] = []
    const tasks: Task[] = [
      {
        name: 'slow',
        everyMinutes: 1,
        run: () => {
          starts += 1
          return new Promise(() => undefined)
        },
      },
    ]

    startScheduler({
      tasks,
      budgetMs: 1_000,
      now: () => clock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      onOverlap: (at) => overlaps.push(at),
    })

    clock = NOON + MINUTE_MS
    timers.fire()
    await settled()

    clock = NOON + 2 * MINUTE_MS
    timers.fire()
    await settled()

    expect(starts).toBe(1)
    expect(overlaps).toEqual([NOON + 2 * MINUTE_MS])
  })

  it('ignores a timer that fires twice inside the same minute', async () => {
    const timers = timerQueue()
    let clock = NOON
    let runs = 0
    const tasks: Task[] = [
      {
        name: 'tick',
        everyMinutes: 1,
        run: () => {
          runs += 1
        },
      },
    ]

    startScheduler({
      tasks,
      now: () => clock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    })

    clock = NOON + MINUTE_MS
    timers.fire()
    await settled()
    clock = NOON + MINUTE_MS + 40
    timers.fire()
    await settled()

    expect(runs).toBe(1)
  })

  it('stops for good once it is stopped', async () => {
    const timers = timerQueue()
    let clock = NOON
    let runs = 0
    const tasks: Task[] = [
      {
        name: 'tick',
        everyMinutes: 1,
        run: () => {
          runs += 1
        },
      },
    ]

    const stop = startScheduler({
      tasks,
      now: () => clock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    })

    stop()
    clock = NOON + MINUTE_MS
    timers.fire()
    await settled()

    expect(runs).toBe(0)
    expect(timers.pending).toHaveLength(0)
  })

  it('hands every summary to the reporter', async () => {
    const timers = timerQueue()
    let clock = NOON
    const summaries: RunSummary[] = []
    const tasks: Task[] = [{ name: 'tick', everyMinutes: 1, run: () => undefined }]

    startScheduler({
      tasks,
      now: () => clock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      onSummary: (summary) => summaries.push(summary),
    })

    clock = NOON + MINUTE_MS
    timers.fire()
    await settled()

    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({ cron: '* * * * *', scheduledAt: NOON + MINUTE_MS })
  })
})
