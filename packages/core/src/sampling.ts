import { isLogLevel, passesThreshold } from './levels.ts'
import type { LogLevel } from './types.ts'

export const DEFAULT_SAMPLE_RATE = 1
export const DEFAULT_ALWAYS_SAMPLE_FROM: LogLevel = 'error'

export function normaliseSampleRate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SAMPLE_RATE
  }
  if (value <= 0) {
    return 0
  }
  return value >= 1 ? 1 : value
}

export function normaliseAlwaysSampleFrom(value: unknown): LogLevel | false {
  if (value === false) {
    return false
  }
  return isLogLevel(value) ? value : DEFAULT_ALWAYS_SAMPLE_FROM
}

export function traceRatio(traceId: string): number {
  let hash = 2166136261
  for (let index = 0; index < traceId.length; index += 1) {
    hash ^= traceId.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967296
}

export type SamplingPolicy = {
  rate: number
  alwaysFrom: LogLevel | false
}

function ratioFrom(random: () => number): number {
  let value: unknown
  try {
    value = random()
  } catch {
    return 0
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) {
    return 0
  }
  return value
}

export function shouldSample(
  policy: SamplingPolicy,
  level: LogLevel,
  traceId: string | undefined,
  random: () => number,
): boolean {
  if (policy.rate >= 1) {
    return true
  }
  if (policy.alwaysFrom !== false && passesThreshold(level, policy.alwaysFrom)) {
    return true
  }
  if (policy.rate <= 0) {
    return false
  }
  const ratio =
    typeof traceId === 'string' && traceId !== '' ? traceRatio(traceId) : ratioFrom(random)
  return ratio < policy.rate
}
