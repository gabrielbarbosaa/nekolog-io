import type { AlertCondition, AlertRule } from '@nekolog-io/adapters'
import { describe, expect, it } from 'vitest'
import {
  alertBatchQuery,
  ERROR_LEVELS,
  MAX_RULES_PER_QUERY,
  MEASURE_PREFIX,
  measurableHere,
  measurementsFrom,
} from './alerts.ts'

const AT = new Date('2026-11-04T12:00:00.000Z')
const SCOPE = { projectId: 'prj_1', environmentId: 'env_prod' }
const TARGET = { database: 'nekolog_dev' }
const CHANNEL = 'ch_01JBQ8R4T7V2WXYZ0123456789'

function rule(id: string, condition: Partial<AlertCondition> = {}): AlertRule {
  return {
    id,
    projectId: SCOPE.projectId,
    environmentId: SCOPE.environmentId,
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
  }
}

describe('which rules this module can measure', () => {
  it('is the three that count logs, never the two that watch issues', () => {
    expect(measurableHere(rule('a', { type: 'threshold' }))).toBe(true)
    expect(measurableHere(rule('b', { type: 'error_rate', minEvents: 1 }))).toBe(true)
    expect(
      measurableHere(rule('c', { type: 'absence', operator: undefined, value: undefined })),
    ).toBe(true)
    expect(
      measurableHere(rule('d', { type: 'new_issue', operator: undefined, value: undefined })),
    ).toBe(false)
    expect(
      measurableHere(
        rule('e', { type: 'issue_regression', operator: undefined, value: undefined }),
      ),
    ).toBe(false)
  })
})

describe('the batch query', () => {
  it('measures many rules in one statement, which is the whole point', () => {
    const batch = alertBatchQuery([rule('alr_a'), rule('alr_b'), rule('alr_c')], SCOPE, AT, TARGET)

    expect(batch.sql.match(/countIf\(/g)).toHaveLength(3)
    expect(batch.sql.match(/FROM /g)).toHaveLength(1)
    expect(batch.columns.map((one) => one.ruleId)).toEqual(['alr_a', 'alr_b', 'alr_c'])
  })

  it('scopes to one project and one environment, as bound parameters', () => {
    const batch = alertBatchQuery([rule('alr_a')], SCOPE, AT, TARGET)

    expect(batch.sql).toContain(`project_id = {${MEASURE_PREFIX}_project:String}`)
    expect(batch.sql).toContain(`environment_id = {${MEASURE_PREFIX}_environment:String}`)
    expect(batch.params[`${MEASURE_PREFIX}_project`]).toBe('prj_1')
    expect(batch.params[`${MEASURE_PREFIX}_environment`]).toBe('env_prod')
    expect(batch.sql).not.toContain('prj_1')
  })

  it('gives every rule its own window inside the shared scan', () => {
    const batch = alertBatchQuery(
      [rule('alr_a', { window: '1m' }), rule('alr_b', { window: '1h' })],
      SCOPE,
      AT,
      TARGET,
    )

    expect(batch.params[`${MEASURE_PREFIX}_from0`]).toBe('2026-11-04 11:59:00.000')
    expect(batch.params[`${MEASURE_PREFIX}_from1`]).toBe('2026-11-04 11:00:00.000')
  })

  it('scans only as far back as the widest window needs', () => {
    const batch = alertBatchQuery(
      [rule('alr_a', { window: '1m' }), rule('alr_b', { window: '1h' })],
      SCOPE,
      AT,
      TARGET,
    )

    expect(batch.params[`${MEASURE_PREFIX}_earliest`]).toBe('2026-11-04 11:00:00.000')
    expect(batch.params[`${MEASURE_PREFIX}_to`]).toBe('2026-11-04 12:00:00.000')
  })

  it('puts that bound in the statement, not only in the parameters', () => {
    const batch = alertBatchQuery([rule('alr_a', { window: '1m' })], SCOPE, AT, TARGET)

    expect(batch.sql).toContain(`timestamp >= {${MEASURE_PREFIX}_earliest:DateTime64(3)}`)
    expect(batch.sql).toContain(`timestamp < {${MEASURE_PREFIX}_to:DateTime64(3)}`)
  })

  it('bounds the scan even when every rule carries its own window anyway', () => {
    const narrow = alertBatchQuery([rule('alr_a', { window: '1m' })], SCOPE, AT, TARGET)
    const wide = alertBatchQuery([rule('alr_a', { window: '1h' })], SCOPE, AT, TARGET)

    expect(narrow.sql).toContain(`${MEASURE_PREFIX}_earliest`)
    expect(wide.sql).toContain(`${MEASURE_PREFIX}_earliest`)
    expect(narrow.params[`${MEASURE_PREFIX}_earliest`]).not.toBe(
      wide.params[`${MEASURE_PREFIX}_earliest`],
    )
  })

  it('keeps each rule search in its own parameters, so two rules cannot collide', () => {
    const batch = alertBatchQuery(
      [rule('alr_a', { query: 'service:api' }), rule('alr_b', { query: 'service:web' })],
      SCOPE,
      AT,
      TARGET,
    )

    expect(batch.params.r0_p1).toBe('api')
    expect(batch.params.r1_p1).toBe('web')
    expect(batch.sql).toContain('{r0_p1:String}')
    expect(batch.sql).toContain('{r1_p1:String}')
    expect(batch.sql).not.toContain('service:api')
  })

  it('asks for the error levels only for an error_rate rule', () => {
    const batch = alertBatchQuery(
      [rule('alr_a'), rule('alr_b', { type: 'error_rate', value: 5, minEvents: 10 })],
      SCOPE,
      AT,
      TARGET,
    )

    expect(batch.columns[0]?.errors).toBeNull()
    expect(batch.columns[1]?.errors).toBe('errors1')
    expect(batch.sql).toContain(ERROR_LEVELS.map((level) => `'${level}'`).join(', '))
  })

  it('counts an error_rate rule twice and a threshold rule once', () => {
    const batch = alertBatchQuery(
      [rule('alr_a'), rule('alr_b', { type: 'error_rate', value: 5, minEvents: 10 })],
      SCOPE,
      AT,
      TARGET,
    )

    expect(batch.sql.match(/countIf\(/g)).toHaveLength(3)
  })

  it('leaves out the rules it cannot measure instead of inventing a column', () => {
    const batch = alertBatchQuery(
      [
        rule('alr_a'),
        rule('alr_b', { type: 'new_issue', query: '', operator: undefined, value: undefined }),
      ],
      SCOPE,
      AT,
      TARGET,
    )

    expect(batch.columns.map((one) => one.ruleId)).toEqual(['alr_a'])
  })

  it('refuses a batch with nothing it can measure', () => {
    expect(() =>
      alertBatchQuery(
        [rule('alr_b', { type: 'new_issue', query: '', operator: undefined, value: undefined })],
        SCOPE,
        AT,
        TARGET,
      ),
    ).toThrow(/no rule to measure/)
  })

  it('refuses more rules than it will put in one statement', () => {
    const many = Array.from({ length: MAX_RULES_PER_QUERY + 1 }, (_, at) => rule(`alr_${at}`))

    expect(() => alertBatchQuery(many, SCOPE, AT, TARGET)).toThrow(/the limit is 100/)
  })

  it('refuses a database name that is not an identifier', () => {
    expect(() =>
      alertBatchQuery([rule('alr_a')], SCOPE, AT, { database: 'x; DROP TABLE logs' }),
    ).toThrow(/Refusing/)
  })

  it('refuses an empty scope rather than measuring every tenant at once', () => {
    expect(() => alertBatchQuery([rule('alr_a')], { ...SCOPE, projectId: '' }, AT, TARGET)).toThrow(
      /no environment to scope it to/,
    )
    expect(() =>
      alertBatchQuery([rule('alr_a')], { ...SCOPE, environmentId: '' }, AT, TARGET),
    ).toThrow(/no environment to scope it to/)
  })

  it('refuses a moment that is not a moment', () => {
    expect(() => alertBatchQuery([rule('alr_a')], SCOPE, new Date('nope'), TARGET)).toThrow(
      /not a moment/,
    )
  })
})

describe('reading the answer back', () => {
  it('pairs every column with the rule that asked for it', () => {
    const batch = alertBatchQuery(
      [rule('alr_a'), rule('alr_b', { type: 'error_rate', value: 5, minEvents: 10 })],
      SCOPE,
      AT,
      TARGET,
    )

    expect(measurementsFrom(batch, { matched0: '7', matched1: '100', errors1: '12' })).toEqual([
      { ruleId: 'alr_a', matched: 7, errors: 0 },
      { ruleId: 'alr_b', matched: 100, errors: 12 },
    ])
  })

  it('takes a count that arrived as a number as readily as one that arrived as text', () => {
    const batch = alertBatchQuery([rule('alr_a')], SCOPE, AT, TARGET)

    expect(measurementsFrom(batch, { matched0: 7 })[0]?.matched).toBe(7)
  })

  it('refuses an answer with no row rather than reading every rule as zero', () => {
    const batch = alertBatchQuery([rule('alr_a')], SCOPE, AT, TARGET)

    expect(() => measurementsFrom(batch, undefined)).toThrow(/no row at all/)
  })

  it('refuses a column that is missing or is not a count', () => {
    const batch = alertBatchQuery([rule('alr_a')], SCOPE, AT, TARGET)

    for (const bad of [{}, { matched0: null }, { matched0: 'many' }, { matched0: -1 }]) {
      expect(() => measurementsFrom(batch, bad)).toThrow(/which is no count/)
    }
  })
})
