export const ALERT_TYPES = [
  'threshold',
  'error_rate',
  'new_issue',
  'issue_regression',
  'absence',
] as const
export const ALERT_WINDOWS = ['1m', '5m', '15m', '1h'] as const
export const ALERT_OPERATORS = ['>', '>=', '<', '<='] as const
export const ALERT_STATES = ['ok', 'firing'] as const

export type AlertType = (typeof ALERT_TYPES)[number]
export type AlertWindow = (typeof ALERT_WINDOWS)[number]
export type AlertOperator = (typeof ALERT_OPERATORS)[number]
export type AlertState = (typeof ALERT_STATES)[number]

export const MAX_ALERT_RULES_PER_PROJECT = 20
export const MAX_ALERT_QUERY_CHARS = 2000
export const MAX_ALERT_CHANNELS_PER_RULE = 10
export const MAX_COOLDOWN_MINUTES = 1440
export const DEFAULT_COOLDOWN_MINUTES = 30
export const MAX_ERROR_RATE_PERCENT = 100

export const WINDOW_MINUTES: Readonly<Record<AlertWindow, number>> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1h': 60,
}

const DURATION = /^(\d{1,5})(m|h)$/
const CHANNEL_ID = /^ch_[0-9A-HJKMNP-TV-Z]{26}$/

export type AlertCondition = {
  type: AlertType
  query: string
  window: AlertWindow
  operator?: AlertOperator
  value?: number
  minEvents?: number
  cooldown: string
  channels: readonly string[]
}

export class AlertRuleError extends Error {
  readonly field: string

  constructor(field: string, reason: string) {
    super(`${field}: ${reason}`)
    this.name = 'AlertRuleError'
    this.field = field
  }
}

export function cooldownMinutes(value: string): number {
  const match = DURATION.exec(value)
  if (match === null) {
    throw new AlertRuleError(
      'cooldown',
      `${JSON.stringify(value)} is not a duration like 30m or 2h`,
    )
  }
  const amount = Number(match[1])
  const minutes = match[2] === 'h' ? amount * 60 : amount
  if (minutes < 1 || minutes > MAX_COOLDOWN_MINUTES) {
    throw new AlertRuleError(
      'cooldown',
      `a cooldown is between one minute and ${MAX_COOLDOWN_MINUTES}, not ${minutes}`,
    )
  }
  return minutes
}

export function windowMinutes(value: AlertWindow): number {
  return WINDOW_MINUTES[value]
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AlertRuleError('condition', 'a rule condition is a JSON object')
  }
  return value as Record<string, unknown>
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new AlertRuleError(field, `expected one of ${allowed.join(', ')}`)
  }
  return value as T
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AlertRuleError(field, 'expected a number')
  }
  return value
}

function channelsOf(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AlertRuleError('channels', 'a rule with no channel can never tell anybody')
  }
  if (value.length > MAX_ALERT_CHANNELS_PER_RULE) {
    throw new AlertRuleError('channels', `at most ${MAX_ALERT_CHANNELS_PER_RULE} channels`)
  }
  const seen = new Set<string>()
  for (const one of value) {
    if (typeof one !== 'string' || !CHANNEL_ID.test(one)) {
      throw new AlertRuleError('channels', `${JSON.stringify(one)} is not a channel id`)
    }
    if (seen.has(one)) {
      throw new AlertRuleError('channels', `${one} appears twice`)
    }
    seen.add(one)
  }
  return value as readonly string[]
}

export function needsAThreshold(type: AlertType): boolean {
  return type === 'threshold' || type === 'error_rate'
}

export function needsAQuery(type: AlertType): boolean {
  return type === 'threshold' || type === 'error_rate' || type === 'absence'
}

export function parseAlertCondition(input: unknown): AlertCondition {
  const raw = asRecord(input)
  const type = oneOf(raw.type, ALERT_TYPES, 'type')
  const window = oneOf(raw.window, ALERT_WINDOWS, 'window')

  const query = raw.query === undefined ? '' : raw.query
  if (typeof query !== 'string') {
    throw new AlertRuleError('query', 'expected a string')
  }
  if (query.length > MAX_ALERT_QUERY_CHARS) {
    throw new AlertRuleError('query', `at most ${MAX_ALERT_QUERY_CHARS} characters`)
  }
  if (!needsAQuery(type) && query !== '') {
    throw new AlertRuleError('query', `a ${type} rule watches issues, not a search`)
  }

  const cooldown = typeof raw.cooldown === 'string' ? raw.cooldown : `${DEFAULT_COOLDOWN_MINUTES}m`
  cooldownMinutes(cooldown)

  const condition: AlertCondition = {
    type,
    query,
    window,
    cooldown,
    channels: channelsOf(raw.channels),
  }

  if (needsAThreshold(type)) {
    const operator = oneOf(raw.operator, ALERT_OPERATORS, 'operator')
    const value = finiteNumber(raw.value, 'value')
    if (value < 0) {
      throw new AlertRuleError('value', 'a count is never negative')
    }
    if (type === 'error_rate' && value > MAX_ERROR_RATE_PERCENT) {
      throw new AlertRuleError('value', 'an error rate is a percentage, so at most 100')
    }
    condition.operator = operator
    condition.value = value
  } else if (raw.operator !== undefined || raw.value !== undefined) {
    throw new AlertRuleError('operator', `a ${type} rule has nothing to compare`)
  }

  if (type === 'error_rate') {
    const minEvents = raw.minEvents === undefined ? 0 : finiteNumber(raw.minEvents, 'minEvents')
    if (minEvents < 0) {
      throw new AlertRuleError('minEvents', 'a volume floor is never negative')
    }
    condition.minEvents = minEvents
  } else if (raw.minEvents !== undefined) {
    throw new AlertRuleError('minEvents', `only an error_rate rule has a volume floor`)
  }

  return condition
}

export function compare(measured: number, operator: AlertOperator, value: number): boolean {
  if (operator === '>') {
    return measured > value
  }
  if (operator === '>=') {
    return measured >= value
  }
  if (operator === '<') {
    return measured < value
  }
  return measured <= value
}

export interface AlertRule {
  id: string
  projectId: string
  environmentId: string
  name: string
  condition: AlertCondition
  state: AlertState
  stateChangedAt: number | null
  lastNotifiedAt: number | null
}

export interface AlertTransition {
  ruleId: string
  to: AlertState
  measured: number
  at: number
}

export interface AlertRuleStore {
  live(limit: number): Promise<ReadonlyArray<AlertRule>>
  applyTransitions(transitions: ReadonlyArray<AlertTransition>): Promise<number>
}
