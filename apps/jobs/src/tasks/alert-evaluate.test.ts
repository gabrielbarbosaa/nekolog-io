import type { AlertCondition, AlertRule, AlertTransition } from '@nekolog-io/adapters'
import { describe, expect, it } from 'vitest'
import type { TaskContext } from '../task.ts'
import {
  type AlertEvaluateEvent,
  type AlertEvaluateReport,
  alertEvaluateTask,
  groupByEnvironment,
  measuredValue,
  shouldFire,
} from './alert-evaluate.ts'

const AT = Date.UTC(2026, 10, 4, 12, 0, 0)
const CHANNEL = 'ch_01JBQ8R4T7V2WXYZ0123456789'

function rule(
  id: string,
  condition: Partial<AlertCondition> = {},
  over: Partial<AlertRule> = {},
): AlertRule {
  return {
    id,
    projectId: 'prj_1',
    environmentId: 'env_prod',
    name: id,
    state: 'ok',
    stateChangedAt: null,
    lastNotifiedAt: null,
    condition: {
      type: 'threshold',
      query: '',
      window: '5m',
      operator: '>',
      value: 10,
      cooldown: '30m',
      channels: [CHANNEL],
      ...condition,
    },
    ...over,
  }
}

function context(signal = new AbortController().signal): TaskContext {
  return { scheduledAt: AT, signal } as TaskContext
}

type Harness = {
  statements: Array<{ sql: string; params: Record<string, string> }>
  applied: AlertTransition[][]
  events: AlertEvaluateEvent[]
  run: (signal?: AbortSignal) => Promise<AlertEvaluateReport>
}

function harness(
  rules: AlertRule[],
  counts: Record<string, unknown>,
  extras: {
    measure?: (sql: string) => Promise<ReadonlyArray<Record<string, unknown>>>
    issueActivity?: (environmentId: string) => Promise<{ opened: number; regressed: number }>
  } = {},
): Harness {
  const statements: Array<{ sql: string; params: Record<string, string> }> = []
  const applied: AlertTransition[][] = []
  const events: AlertEvaluateEvent[] = []

  const task = alertEvaluateTask({
    rules: {
      async live() {
        return rules
      },
      async applyTransitions(transitions) {
        applied.push([...transitions])
        return transitions.length
      },
    },
    target: { database: 'nekolog_dev' },
    now: () => AT,
    onEvent: (event) => events.push(event),
    ...(extras.issueActivity === undefined
      ? {}
      : { issueActivity: async (environmentId) => extras.issueActivity?.(environmentId) as never }),
    measure: async (sql, params) => {
      statements.push({ sql, params })
      if (extras.measure !== undefined) {
        return extras.measure(sql)
      }
      return [counts]
    },
  })

  return {
    statements,
    applied,
    events,
    run: async (signal) => (await task.run(context(signal))) as AlertEvaluateReport,
  }
}

describe('what a rule measured', () => {
  it('is the count for a threshold rule', () => {
    expect(measuredValue(rule('a'), { ruleId: 'a', matched: 42, errors: 3 })).toBe(42)
  })

  it('is a percentage for an error_rate rule', () => {
    const one = rule('a', { type: 'error_rate', value: 5, minEvents: 1 })

    expect(measuredValue(one, { ruleId: 'a', matched: 200, errors: 10 })).toBe(5)
  })

  it('is zero, not a division by zero, when the search matched nothing', () => {
    const one = rule('a', { type: 'error_rate', value: 5, minEvents: 1 })

    expect(measuredValue(one, { ruleId: 'a', matched: 0, errors: 0 })).toBe(0)
  })
})

describe('whether a rule fires', () => {
  it('compares with the operator the rule carries', () => {
    const one = rule('a', { operator: '>', value: 10 })

    expect(shouldFire(one, 11, { ruleId: 'a', matched: 11, errors: 0 })).toBe(true)
    expect(shouldFire(one, 10, { ruleId: 'a', matched: 10, errors: 0 })).toBe(false)
  })

  it('fires an absence rule exactly when nothing arrived', () => {
    const one = rule('a', { type: 'absence', operator: undefined, value: undefined })

    expect(shouldFire(one, 0, { ruleId: 'a', matched: 0, errors: 0 })).toBe(true)
    expect(shouldFire(one, 1, { ruleId: 'a', matched: 1, errors: 0 })).toBe(false)
  })

  it('holds an error_rate rule back until the volume floor is reached', () => {
    const one = rule('a', { type: 'error_rate', value: 10, minEvents: 100 })

    expect(shouldFire(one, 50, { ruleId: 'a', matched: 99, errors: 50 })).toBe(false)
    expect(shouldFire(one, 50, { ruleId: 'a', matched: 100, errors: 50 })).toBe(true)
  })
})

describe('grouping', () => {
  it('puts every rule of one environment together, which is what makes it one query', () => {
    const groups = groupByEnvironment([
      rule('a'),
      rule('b'),
      rule('c', {}, { environmentId: 'env_stag' }),
      rule('d', {}, { projectId: 'prj_2', environmentId: 'env_prod' }),
    ])

    expect(groups).toHaveLength(3)
    expect(groups[0]?.[1].map((one) => one.id)).toEqual(['a', 'b'])
  })
})

describe('the evaluator', () => {
  it('asks ClickHouse once for a whole environment, however many rules it has', async () => {
    const one = harness([rule('alr_a'), rule('alr_b'), rule('alr_c')], {
      matched0: 1,
      matched1: 1,
      matched2: 1,
    })

    const report = await one.run()

    expect(one.statements).toHaveLength(1)
    expect(report).toMatchObject({ rules: 3, environments: 1, measured: 3 })
  })

  it('asks once per environment, not once per rule', async () => {
    const one = harness([rule('alr_a'), rule('alr_b', {}, { environmentId: 'env_stag' })], {
      matched0: 1,
    })

    await one.run()

    expect(one.statements).toHaveLength(2)
  })

  it('moves a rule to firing and records the transition once', async () => {
    const one = harness([rule('alr_a', { value: 10 })], { matched0: 99 })

    const report = await one.run()

    expect(report).toMatchObject({ fired: 1, resolved: 0 })
    expect(one.applied[0]).toEqual([{ ruleId: 'alr_a', to: 'firing', measured: 99, at: AT }])
  })

  it('says nothing when a firing rule is still firing', async () => {
    const one = harness([rule('alr_a', { value: 10 }, { state: 'firing' })], { matched0: 99 })

    const report = await one.run()

    expect(report).toMatchObject({ fired: 0, resolved: 0 })
    expect(one.applied).toEqual([])
  })

  it('resolves a firing rule once it falls back under the value', async () => {
    const one = harness([rule('alr_a', { value: 10 }, { state: 'firing' })], { matched0: 1 })

    const report = await one.run()

    expect(report).toMatchObject({ fired: 0, resolved: 1 })
    expect(one.applied[0]).toEqual([{ ruleId: 'alr_a', to: 'ok', measured: 1, at: AT }])
  })

  it('says nothing when a quiet rule is still quiet', async () => {
    const one = harness([rule('alr_a', { value: 10 })], { matched0: 1 })

    expect(await one.run()).toMatchObject({ fired: 0, resolved: 0 })
    expect(one.applied).toEqual([])
  })

  it('fires an absence rule when the environment went silent', async () => {
    const one = harness(
      [
        rule('alr_a', {
          type: 'absence',
          query: 'service:billing',
          operator: undefined,
          value: undefined,
        }),
      ],
      { matched0: 0 },
    )

    expect(await one.run()).toMatchObject({ fired: 1 })
  })

  it('reads a new_issue rule from the issue activity, not from ClickHouse', async () => {
    const one = harness(
      [rule('alr_a', { type: 'new_issue', query: '', operator: undefined, value: undefined })],
      {},
      { issueActivity: async () => ({ opened: 3, regressed: 0 }) },
    )

    const report = await one.run()

    expect(one.statements).toEqual([])
    expect(report).toMatchObject({ fired: 1, measured: 0 })
  })

  it('tells a regression from a new issue', async () => {
    const one = harness(
      [
        rule('alr_a', { type: 'new_issue', query: '', operator: undefined, value: undefined }),
        rule('alr_b', {
          type: 'issue_regression',
          query: '',
          operator: undefined,
          value: undefined,
        }),
      ],
      {},
      { issueActivity: async () => ({ opened: 0, regressed: 2 }) },
    )

    const report = await one.run()

    expect(report).toMatchObject({ fired: 1 })
    expect(one.applied[0]?.map((one) => one.ruleId)).toEqual(['alr_b'])
  })

  it('skips an issue rule rather than guessing when nothing can answer it', async () => {
    const one = harness(
      [rule('alr_a', { type: 'new_issue', query: '', operator: undefined, value: undefined })],
      {},
    )

    expect(await one.run()).toMatchObject({ skipped: 1, fired: 0 })
  })

  it('skips an environment whose query failed, and keeps the others', async () => {
    let call = 0
    const one = harness(
      [rule('alr_a'), rule('alr_b', {}, { environmentId: 'env_stag' })],
      {},
      {
        measure: async () => {
          call += 1
          if (call === 1) {
            throw new Error('ClickHouse is down')
          }
          return [{ matched0: 99 }]
        },
      },
    )

    const report = await one.run()

    expect(report).toMatchObject({ skipped: 1, fired: 1 })
    expect(one.events).toContainEqual({
      kind: 'environment_failed',
      environmentId: 'env_prod',
      why: 'ClickHouse is down',
    })
  })

  it('never resolves a rule because a query failed', async () => {
    const one = harness(
      [rule('alr_a', { value: 10 }, { state: 'firing' })],
      {},
      {
        measure: async () => {
          throw new Error('ClickHouse is down')
        },
      },
    )

    const report = await one.run()

    expect(report).toMatchObject({ resolved: 0, skipped: 1 })
    expect(one.applied).toEqual([])
  })

  it('says so rather than guessing when the rule store cannot be reached', async () => {
    const task = alertEvaluateTask({
      rules: {
        async live() {
          throw new Error('postgres is asleep')
        },
        async applyTransitions() {
          return 0
        },
      },
      measure: async () => [],
      target: { database: 'nekolog_dev' },
    })

    expect(await task.run(context())).toMatchObject({ stopped: 'store_unavailable', rules: 0 })
  })

  it('does nothing at all when there is no live rule', async () => {
    const one = harness([], {})

    expect(await one.run()).toMatchObject({ rules: 0, environments: 0, measured: 0 })
    expect(one.statements).toEqual([])
  })

  it('stops when the deadline passed rather than measuring another environment', async () => {
    const controller = new AbortController()
    controller.abort()
    const one = harness([rule('alr_a')], { matched0: 99 })

    const report = await one.run(controller.signal)

    expect(report.stopped).toBe('out_of_time')
    expect(one.statements).toEqual([])
  })
})
