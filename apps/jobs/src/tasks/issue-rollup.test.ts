import { type IssueOccurrence, memoryIssueStore } from '@nekolog-io/adapters'
import { describe, expect, it } from 'vitest'
import { assertTask } from '../task.ts'
import {
  ISSUE_ROLLUP_TASK,
  type IssueRollupReport,
  type IssueSourceLike,
  issueRollupTask,
  MINUTE_MS,
  windowFor,
} from './issue-rollup.ts'

const SCHEDULED_AT = Date.UTC(2026, 10, 3, 12, 5, 37, 412)

function occurrence(overrides: Partial<IssueOccurrence> = {}): IssueOccurrence {
  return {
    projectId: 'prj_1',
    environmentId: 'env_prod',
    fingerprint: '42',
    events: 2,
    firstSeen: SCHEDULED_AT - 90_000,
    lastSeen: SCHEDULED_AT - 80_000,
    level: 'error',
    errorType: 'TypeError',
    title: 'boom',
    service: 'api',
    release: '1.0.0',
    ...overrides,
  }
}

function source(
  occurrences: ReadonlyArray<IssueOccurrence> | (() => never),
): IssueSourceLike & { windows: Array<{ from: number; to: number }> } {
  const windows: Array<{ from: number; to: number }> = []
  return {
    windows,
    async occurrencesBetween(window) {
      windows.push(window)
      if (typeof occurrences === 'function') {
        return occurrences()
      }
      return occurrences
    },
  }
}

function context(aborted = false) {
  const controller = new AbortController()
  if (aborted) {
    controller.abort()
  }
  return { scheduledAt: SCHEDULED_AT, cron: '* * * * *', signal: controller.signal }
}

describe('the window it looks at', () => {
  it('is one whole minute, one minute behind the tick', () => {
    expect(windowFor(SCHEDULED_AT, 1)).toEqual({
      from: Date.UTC(2026, 10, 3, 12, 3, 0),
      to: Date.UTC(2026, 10, 3, 12, 4, 0),
    })
  })

  it('does not depend on where inside the minute the tick landed', () => {
    const early = windowFor(Date.UTC(2026, 10, 3, 12, 5, 0, 0), 1)
    const late = windowFor(Date.UTC(2026, 10, 3, 12, 5, 59, 999), 1)

    expect(early).toEqual(late)
  })

  it('never overlaps the window of the minute before or after', () => {
    const before = windowFor(SCHEDULED_AT - MINUTE_MS, 1)
    const now = windowFor(SCHEDULED_AT, 1)
    const after = windowFor(SCHEDULED_AT + MINUTE_MS, 1)

    expect(before.to).toBe(now.from)
    expect(now.to).toBe(after.from)
  })

  it('takes a longer lag when one is configured', () => {
    expect(windowFor(SCHEDULED_AT, 3).to).toBe(Date.UTC(2026, 10, 3, 12, 2, 0))
  })
})

describe('the issue rollup task', () => {
  it('is a task the scheduler accepts, every minute', () => {
    const task = issueRollupTask({ source: source([]), issues: memoryIssueStore() })

    expect(() => assertTask(task)).not.toThrow()
    expect(task.name).toBe(ISSUE_ROLLUP_TASK)
    expect(task.everyMinutes).toBe(1)
  })

  it('asks the source for the window and hands what it finds to the store', async () => {
    const found = source([occurrence(), occurrence({ environmentId: 'env_stag' })])
    const issues = memoryIssueStore()

    const report = (await issueRollupTask({ source: found, issues }).run(
      context(),
    )) as IssueRollupReport

    expect(found.windows).toEqual([windowFor(SCHEDULED_AT, 1)])
    expect(report).toMatchObject({ occurrences: 2, created: 1, updated: 1, stopped: 'finished' })
    expect(issues.issues()[0]?.events).toBe(4)
  })

  it('writes nothing when the window held no error', async () => {
    const issues = memoryIssueStore()
    const report = (await issueRollupTask({ source: source([]), issues }).run(
      context(),
    )) as IssueRollupReport

    expect(report).toMatchObject({ occurrences: 0, created: 0, updated: 0 })
    expect(issues.issues()).toHaveLength(0)
  })

  it('reports that it could not measure rather than pretending there was nothing', async () => {
    const issues = memoryIssueStore()
    const broken = source((): never => {
      throw new Error('ClickHouse is down')
    })

    const report = (await issueRollupTask({ source: broken, issues }).run(
      context(),
    )) as IssueRollupReport

    expect(report.stopped).toBe('source_unavailable')
    expect(report.occurrences).toBe(0)
    expect(issues.issues()).toHaveLength(0)
  })

  it('stops before writing when it has run out of time', async () => {
    const issues = memoryIssueStore()
    const report = (await issueRollupTask({ source: source([occurrence()]), issues }).run(
      context(true),
    )) as IssueRollupReport

    expect(report.stopped).toBe('out_of_time')
    expect(issues.issues()).toHaveLength(0)
  })

  it('counts a reopen in its report', async () => {
    const issues = memoryIssueStore()
    await issues.record([occurrence()])
    issues.resolve('prj_1', '42', SCHEDULED_AT - 85_000)

    const report = (await issueRollupTask({
      source: source([occurrence({ lastSeen: SCHEDULED_AT - 10_000 })]),
      issues,
    }).run(context())) as IssueRollupReport

    expect(report.reopened).toBe(1)
  })
})
