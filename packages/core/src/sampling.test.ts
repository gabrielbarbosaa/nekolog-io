import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ALWAYS_SAMPLE_FROM,
  DEFAULT_SAMPLE_RATE,
  normaliseAlwaysSampleFrom,
  normaliseSampleRate,
  type SamplingPolicy,
  shouldSample,
  traceRatio,
} from './sampling.ts'
import type { LogLevel } from './types.ts'

function policy(overrides: Partial<SamplingPolicy> = {}): SamplingPolicy {
  return { rate: DEFAULT_SAMPLE_RATE, alwaysFrom: DEFAULT_ALWAYS_SAMPLE_FROM, ...overrides }
}

function traceIdFor(seed: number): string {
  return seed.toString(16).padStart(32, '0')
}

describe('normaliseSampleRate', () => {
  it.each([
    [0.25, 0.25],
    [0, 0],
    [1, 1],
    [-3, 0],
    [7, 1],
  ])('maps %s to %s', (input, expected) => {
    expect(normaliseSampleRate(input)).toBe(expected)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, '0.5', null, undefined])(
    'keeps every log when the rate is not a usable number (%s)',
    (input) => {
      expect(normaliseSampleRate(input)).toBe(1)
    },
  )
})

describe('normaliseAlwaysSampleFrom', () => {
  it('keeps a level', () => {
    expect(normaliseAlwaysSampleFrom('warn')).toBe('warn')
  })

  it('accepts false, which is how you sample errors too', () => {
    expect(normaliseAlwaysSampleFrom(false)).toBe(false)
  })

  it.each(['verbose', undefined, null, 3])('falls back to error for %s', (input) => {
    expect(normaliseAlwaysSampleFrom(input)).toBe('error')
  })
})

describe('shouldSample', () => {
  const never = () => 0.999

  it('keeps everything at rate 1 without consulting anything', () => {
    let calls = 0
    const random = () => {
      calls += 1
      return 0.999
    }

    expect(shouldSample(policy(), 'debug', undefined, random)).toBe(true)
    expect(calls).toBe(0)
  })

  it('keeps error and fatal even at rate 0', () => {
    expect(shouldSample(policy({ rate: 0 }), 'error', undefined, never)).toBe(true)
    expect(shouldSample(policy({ rate: 0 }), 'fatal', undefined, never)).toBe(true)
    expect(shouldSample(policy({ rate: 0 }), 'warn', undefined, never)).toBe(false)
  })

  it('samples errors too once the floor is turned off', () => {
    expect(shouldSample(policy({ rate: 0, alwaysFrom: false }), 'error', undefined, never)).toBe(
      false,
    )
  })

  it('moves the floor', () => {
    const moved = policy({ rate: 0, alwaysFrom: 'warn' })
    expect(shouldSample(moved, 'warn', undefined, never)).toBe(true)
    expect(shouldSample(moved, 'info', undefined, never)).toBe(false)
  })

  it('uses the random source when there is no trace', () => {
    const half = policy({ rate: 0.5 })
    expect(shouldSample(half, 'info', undefined, () => 0.49)).toBe(true)
    expect(shouldSample(half, 'info', undefined, () => 0.5)).toBe(false)
  })

  it('keeps every log of a trace together, so a request is never half recorded', () => {
    const half = policy({ rate: 0.5 })
    const traceId = traceIdFor(12345)

    const decisions = new Set(
      ['trace', 'debug', 'info', 'warn'].map((level) =>
        shouldSample(half, level as LogLevel, traceId, () => 0.9),
      ),
    )

    expect(decisions.size).toBe(1)
  })

  it('ignores the random source when a trace decides it', () => {
    const half = policy({ rate: 0.5 })
    const traceId = traceIdFor(99)

    const byChance = shouldSample(half, 'info', traceId, () => 0.01)
    const byOtherChance = shouldSample(half, 'info', traceId, () => 0.99)

    expect(byChance).toBe(byOtherChance)
  })

  it('lands near the configured rate across many traces', () => {
    const half = policy({ rate: 0.5 })
    let kept = 0
    for (let seed = 0; seed < 2000; seed += 1) {
      if (shouldSample(half, 'info', traceIdFor(seed), never)) {
        kept += 1
      }
    }

    expect(kept / 2000).toBeGreaterThan(0.44)
    expect(kept / 2000).toBeLessThan(0.56)
  })

  it('keeps the log when the random source misbehaves, because losing a log is worse', () => {
    const half = policy({ rate: 0.5 })
    const broken = () => {
      throw new Error('no entropy')
    }

    expect(shouldSample(half, 'info', undefined, broken)).toBe(true)
    expect(shouldSample(half, 'info', undefined, () => Number.NaN)).toBe(true)
    expect(shouldSample(half, 'info', undefined, () => 1)).toBe(true)
  })
})

describe('traceRatio', () => {
  it('is deterministic', () => {
    expect(traceRatio('abc')).toBe(traceRatio('abc'))
  })

  it('stays inside [0, 1)', () => {
    for (let seed = 0; seed < 500; seed += 1) {
      const ratio = traceRatio(traceIdFor(seed))
      expect(ratio).toBeGreaterThanOrEqual(0)
      expect(ratio).toBeLessThan(1)
    }
  })

  it('spreads neighbouring trace ids apart', () => {
    expect(traceRatio(traceIdFor(1))).not.toBe(traceRatio(traceIdFor(2)))
  })
})
