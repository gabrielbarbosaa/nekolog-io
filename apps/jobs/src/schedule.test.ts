import { describe, expect, it } from 'vitest'
import { dueTasks, epochMinute, isDue, MINUTE_MS, registerTasks } from './schedule.ts'
import type { Task } from './task.ts'

function task(name: string, everyMinutes: number, offsetMinutes?: number): Task {
  return {
    name,
    everyMinutes,
    ...(offsetMinutes === undefined ? {} : { offsetMinutes }),
    run: () => undefined,
  }
}

const NOON = Date.UTC(2026, 9, 31, 12, 0, 0)

function minutesAfterNoon(count: number): number {
  return NOON + count * MINUTE_MS
}

describe('epochMinute', () => {
  it('ignores seconds and milliseconds inside the minute', () => {
    expect(epochMinute(NOON + 59_999)).toBe(epochMinute(NOON))
    expect(epochMinute(NOON + MINUTE_MS)).toBe(epochMinute(NOON) + 1)
  })
})

describe('isDue', () => {
  it('runs a one-minute task on every tick', () => {
    const every = task('spool-resend', 1)

    expect([0, 1, 2, 3, 59].every((minute) => isDue(every, minutesAfterNoon(minute)))).toBe(true)
  })

  it('spreads a five-minute task over the same slot of the clock', () => {
    const quotas = task('quotas', 5)
    const due = [0, 1, 2, 3, 4, 5, 6].filter((minute) => isDue(quotas, minutesAfterNoon(minute)))

    expect(due).toEqual([0, 5])
  })

  it('moves the slot with the offset, so two tasks do not pile on one tick', () => {
    const usage = task('usage', 5)
    const digest = task('digest', 5, 2)
    const collisions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter(
      (minute) => isDue(usage, minutesAfterNoon(minute)) && isDue(digest, minutesAfterNoon(minute)),
    )

    expect([0, 1, 2, 3, 4].filter((m) => isDue(digest, minutesAfterNoon(m)))).toEqual([2])
    expect(collisions).toEqual([])
  })

  it('decides from the scheduled time alone, never from memory', () => {
    const hourly = task('retention', 60)
    const first = isDue(hourly, Date.UTC(2026, 9, 31, 13, 0, 0))
    const again = isDue(hourly, Date.UTC(2026, 9, 31, 13, 0, 0))

    expect(first).toBe(true)
    expect(again).toBe(true)
    expect(isDue(hourly, Date.UTC(2026, 9, 31, 13, 1, 0))).toBe(false)
    expect(isDue(hourly, Date.UTC(2026, 9, 31, 14, 0, 0))).toBe(true)
  })

  it('still decides correctly on a remainder that comes out negative', () => {
    const fiveMinutes = task('old', 5)

    expect(isDue(fiveMinutes, -3 * MINUTE_MS)).toBe(false)
    expect(isDue(fiveMinutes, -5 * MINUTE_MS)).toBe(true)
  })
})

describe('dueTasks', () => {
  it('returns only the tasks whose slot this tick is', () => {
    const tasks = [task('a', 1), task('b', 5), task('c', 5, 1)]

    expect(dueTasks(tasks, minutesAfterNoon(0)).map((t) => t.name)).toEqual(['a', 'b'])
    expect(dueTasks(tasks, minutesAfterNoon(1)).map((t) => t.name)).toEqual(['a', 'c'])
  })
})

describe('registerTasks', () => {
  it('accepts a valid set and freezes it', () => {
    const registered = registerTasks([task('a', 1), task('b', 5, 2)])

    expect(registered.map((t) => t.name)).toEqual(['a', 'b'])
    expect(Object.isFrozen(registered)).toBe(true)
  })

  it('refuses two tasks under the same name, which would hide one of them', () => {
    expect(() => registerTasks([task('quotas', 1), task('quotas', 5)])).toThrow(/same name/)
  })

  it.each([0, -1, 1.5, Number.NaN])('refuses everyMinutes of %s', (every) => {
    expect(() => registerTasks([task('a', every)])).toThrow(/everyMinutes/)
  })

  it('refuses an offset the cadence can never reach', () => {
    expect(() => registerTasks([task('a', 5, 5)])).toThrow(/offsetMinutes/)
    expect(() => registerTasks([task('a', 5, -1)])).toThrow(/offsetMinutes/)
  })

  it.each(['Quotas', 'spool resend', '1st', '', 'x'.repeat(64)])('refuses the name %s', (name) => {
    expect(() => registerTasks([task(name, 1)])).toThrow(/Task name/)
  })

  it('refuses a timeout that would never let the task run', () => {
    expect(() => registerTasks([{ ...task('a', 1), timeoutMs: 0 }])).toThrow(/timeoutMs/)
  })
})
