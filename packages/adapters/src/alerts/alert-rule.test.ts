import { describe, expect, it } from 'vitest'
import {
  ALERT_OPERATORS,
  ALERT_TYPES,
  ALERT_WINDOWS,
  AlertRuleError,
  compare,
  cooldownMinutes,
  DEFAULT_COOLDOWN_MINUTES,
  MAX_ALERT_CHANNELS_PER_RULE,
  MAX_ALERT_QUERY_CHARS,
  MAX_ALERT_RULES_PER_PROJECT,
  MAX_COOLDOWN_MINUTES,
  parseAlertCondition,
  WINDOW_MINUTES,
  windowMinutes,
} from '../alert-rule.ts'

const CHANNEL = 'ch_01JBQ8R4T7V2WXYZ0123456789'
const OTHER_CHANNEL = 'ch_01JBQ8R4T7V2WXYZ012345678A'

function threshold(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'threshold',
    query: 'level:error service:api',
    window: '5m',
    operator: '>',
    value: 50,
    cooldown: '30m',
    channels: [CHANNEL],
    ...overrides,
  }
}

describe('the limits specification 6 writes down', () => {
  it('are the literal numbers, not another copy of the constant', () => {
    expect([...ALERT_TYPES]).toEqual([
      'threshold',
      'error_rate',
      'new_issue',
      'issue_regression',
      'absence',
    ])
    expect([...ALERT_WINDOWS]).toEqual(['1m', '5m', '15m', '1h'])
    expect(WINDOW_MINUTES).toEqual({ '1m': 1, '5m': 5, '15m': 15, '1h': 60 })
    expect(MAX_ALERT_RULES_PER_PROJECT).toBe(20)
    expect(MAX_ALERT_QUERY_CHARS).toBe(2000)
    expect(MAX_ALERT_CHANNELS_PER_RULE).toBe(10)
    expect(MAX_COOLDOWN_MINUTES).toBe(1440)
    expect(DEFAULT_COOLDOWN_MINUTES).toBe(30)
  })

  it('turns every window into the minutes the query will use', () => {
    expect(ALERT_WINDOWS.map(windowMinutes)).toEqual([1, 5, 15, 60])
  })
})

describe('the cooldown', () => {
  it('reads minutes and hours', () => {
    expect(cooldownMinutes('30m')).toBe(30)
    expect(cooldownMinutes('2h')).toBe(120)
    expect(cooldownMinutes('1m')).toBe(1)
    expect(cooldownMinutes('24h')).toBe(1440)
  })

  it('refuses anything that is not a duration', () => {
    for (const bad of ['30', 'm', '30s', '-5m', '1.5h', '', 'thirty minutes']) {
      expect(() => cooldownMinutes(bad)).toThrow(AlertRuleError)
    }
  })

  it('refuses a cooldown of nothing, or of more than a day', () => {
    expect(() => cooldownMinutes('0m')).toThrow(/between one minute/)
    expect(() => cooldownMinutes('25h')).toThrow(/between one minute/)
  })
})

describe('parseAlertCondition', () => {
  it('reads the example specification 6 prints', () => {
    const condition = parseAlertCondition(threshold())

    expect(condition).toEqual({
      type: 'threshold',
      query: 'level:error service:api',
      window: '5m',
      operator: '>',
      value: 50,
      cooldown: '30m',
      channels: [CHANNEL],
    })
  })

  it('refuses anything that is not an object', () => {
    for (const bad of [null, [], 'threshold', 42, undefined]) {
      expect(() => parseAlertCondition(bad)).toThrow(/a rule condition is a JSON object/)
    }
  })

  it('refuses a type or a window it does not know', () => {
    expect(() => parseAlertCondition(threshold({ type: 'spike' }))).toThrow(/type/)
    expect(() => parseAlertCondition(threshold({ window: '10m' }))).toThrow(/window/)
  })

  it('accepts every operator the specification lists, and nothing else', () => {
    for (const operator of ALERT_OPERATORS) {
      expect(parseAlertCondition(threshold({ operator })).operator).toBe(operator)
    }
    expect(() => parseAlertCondition(threshold({ operator: '==' }))).toThrow(/operator/)
  })

  it('insists a threshold rule says what to compare against', () => {
    expect(() => parseAlertCondition(threshold({ operator: undefined }))).toThrow(/operator/)
    expect(() => parseAlertCondition(threshold({ value: undefined }))).toThrow(/value/)
    expect(() => parseAlertCondition(threshold({ value: 'fifty' }))).toThrow(/value/)
    expect(() => parseAlertCondition(threshold({ value: -1 }))).toThrow(/never negative/)
  })

  it('refuses a rate above a hundred, because it is a percentage', () => {
    expect(() =>
      parseAlertCondition(threshold({ type: 'error_rate', value: 101, minEvents: 10 })),
    ).toThrow(/percentage/)
    expect(
      parseAlertCondition(threshold({ type: 'error_rate', value: 100, minEvents: 10 })).value,
    ).toBe(100)
  })

  it('gives an error_rate rule a volume floor, and nothing else one', () => {
    expect(
      parseAlertCondition(threshold({ type: 'error_rate', value: 5, minEvents: 100 })).minEvents,
    ).toBe(100)
    expect(parseAlertCondition(threshold({ type: 'error_rate', value: 5 })).minEvents).toBe(0)
    expect(() => parseAlertCondition(threshold({ minEvents: 10 }))).toThrow(/only an error_rate/)
  })

  it('refuses a comparison on a rule that watches issues', () => {
    for (const type of ['new_issue', 'issue_regression'] as const) {
      expect(() =>
        parseAlertCondition({ type, window: '5m', channels: [CHANNEL], operator: '>', value: 1 }),
      ).toThrow(/nothing to compare/)
      expect(parseAlertCondition({ type, window: '5m', channels: [CHANNEL] }).type).toBe(type)
    }
  })

  it('refuses a search on a rule that watches issues, so nobody thinks it filters', () => {
    expect(() =>
      parseAlertCondition({
        type: 'new_issue',
        window: '5m',
        query: 'level:error',
        channels: [CHANNEL],
      }),
    ).toThrow(/watches issues, not a search/)
  })

  it('lets an absence rule carry a search, because that is what it watches for', () => {
    const condition = parseAlertCondition({
      type: 'absence',
      window: '1h',
      query: 'service:billing',
      channels: [CHANNEL],
    })

    expect(condition.query).toBe('service:billing')
    expect(condition.operator).toBeUndefined()
  })

  it('refuses a search longer than the column holds', () => {
    expect(() =>
      parseAlertCondition(threshold({ query: 'a'.repeat(MAX_ALERT_QUERY_CHARS + 1) })),
    ).toThrow(/2000 characters/)
    expect(
      parseAlertCondition(threshold({ query: 'a'.repeat(MAX_ALERT_QUERY_CHARS) })).query,
    ).toHaveLength(MAX_ALERT_QUERY_CHARS)
  })

  it('refuses a rule that can never tell anybody', () => {
    expect(() => parseAlertCondition(threshold({ channels: [] }))).toThrow(/never tell anybody/)
    expect(() => parseAlertCondition(threshold({ channels: undefined }))).toThrow(
      /never tell anybody/,
    )
  })

  it('refuses a channel that is not a channel id, so nothing is smuggled through', () => {
    for (const bad of ['ch_short', 'usr_01JBQ8R4T7V2WXYZ0123456789', 42, null, '']) {
      expect(() => parseAlertCondition(threshold({ channels: [bad] }))).toThrow(/channel id/)
    }
  })

  it('refuses the same channel twice, which would send the same alert twice', () => {
    expect(() => parseAlertCondition(threshold({ channels: [CHANNEL, CHANNEL] }))).toThrow(
      /appears twice/,
    )
    expect(
      parseAlertCondition(threshold({ channels: [CHANNEL, OTHER_CHANNEL] })).channels,
    ).toHaveLength(2)
  })

  it('refuses more channels than the schema allows', () => {
    const many = Array.from(
      { length: MAX_ALERT_CHANNELS_PER_RULE + 1 },
      (_, at) => `ch_01JBQ8R4T7V2WXYZ01234567${String(at).padStart(2, '8')}`,
    )

    expect(() => parseAlertCondition(threshold({ channels: many }))).toThrow(/at most 10/)
  })

  it('falls back to the default cooldown rather than firing without one', () => {
    expect(parseAlertCondition(threshold({ cooldown: undefined })).cooldown).toBe('30m')
  })

  it('names the field that was wrong, so the dashboard can point at it', () => {
    try {
      parseAlertCondition(threshold({ window: 'forever' }))
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(AlertRuleError)
      expect((error as AlertRuleError).field).toBe('window')
    }
  })
})

describe('compare', () => {
  it('does what each operator says', () => {
    expect(compare(51, '>', 50)).toBe(true)
    expect(compare(50, '>', 50)).toBe(false)
    expect(compare(50, '>=', 50)).toBe(true)
    expect(compare(49, '<', 50)).toBe(true)
    expect(compare(50, '<=', 50)).toBe(true)
    expect(compare(51, '<=', 50)).toBe(false)
  })
})
