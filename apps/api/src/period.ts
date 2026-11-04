import { ApiError } from './errors.ts'

export const DEFAULT_PERIOD_MS: number = 60 * 60 * 1000
export const MAX_PERIOD_MS: number = 31 * 24 * 60 * 60 * 1000

export type Period = { from: Date; to: Date }

export const KEY_PARAMETER = 'key'

export function assertKnownParams(params: URLSearchParams, allowed: readonly string[]): void {
  for (const name of new Set(params.keys())) {
    if (name === KEY_PARAMETER || allowed.includes(name)) {
      continue
    }
    throw new ApiError(
      'invalid_query',
      `There is no ${JSON.stringify(name)} parameter on this route. It takes ${allowed.join(', ')}.`,
    )
  }
}

const EPOCH_MILLISECONDS = /^\d{1,15}$/

export function parseMoment(raw: string, what: string): Date {
  const text = raw.trim()
  if (text === '') {
    throw new ApiError('invalid_query', `${what} is empty.`)
  }

  const value = EPOCH_MILLISECONDS.test(text) ? new Date(Number(text)) : new Date(text)
  if (Number.isNaN(value.getTime())) {
    throw new ApiError(
      'invalid_query',
      `${what} has to be an ISO 8601 moment or epoch milliseconds, and ${JSON.stringify(raw)} is neither.`,
    )
  }
  return value
}

export function parsePeriod(params: URLSearchParams, now: number): Period {
  const rawFrom = params.get('from')
  const rawTo = params.get('to')

  const to = rawTo === null ? new Date(now) : parseMoment(rawTo, 'to')
  const from =
    rawFrom === null ? new Date(to.getTime() - DEFAULT_PERIOD_MS) : parseMoment(rawFrom, 'from')

  if (to.getTime() <= from.getTime()) {
    throw new ApiError('invalid_query', 'The period ends before it starts.')
  }

  const span = to.getTime() - from.getTime()
  if (span > MAX_PERIOD_MS) {
    throw new ApiError(
      'period_too_long',
      `This API reads at most ${MAX_PERIOD_MS / (24 * 60 * 60 * 1000)} days at a time, and this period is ${Math.ceil(span / (24 * 60 * 60 * 1000))}.`,
    )
  }

  return { from, to }
}

export function parseCount(
  params: URLSearchParams,
  name: string,
  fallback: number,
  most: number,
): number {
  const raw = params.get(name)
  if (raw === null || raw.trim() === '') {
    return fallback
  }
  if (!/^\d{1,6}$/.test(raw.trim())) {
    throw new ApiError('invalid_query', `${name} has to be a whole number.`)
  }
  const value = Number(raw.trim())
  if (value < 1 || value > most) {
    throw new ApiError('invalid_query', `${name} has to be between 1 and ${most}.`)
  }
  return value
}
