import { describe, expect, it } from 'vitest'
import {
  bucketOf,
  DEFAULT_MIN_LEVEL,
  DEFAULT_SAMPLE_RATE,
  decideIntake,
  LEVELS,
  NEVER_SAMPLED_OUT,
  rankOf,
  SAMPLE_BUCKETS,
  sampleSeed,
  settingsFrom,
} from './intake.ts'

const WIDE_OPEN = { minLevel: 'trace', sampleRate: 1 }

function event(level: string, extras: Record<string, unknown> = {}) {
  return { level, ...extras } as {
    level: string
    trace?: { traceId: string }
    session?: { id?: string }
  }
}

describe('the defaults', () => {
  it('let everything in, which is what an environment nobody configured should do', () => {
    expect(DEFAULT_MIN_LEVEL).toBe('trace')
    expect(DEFAULT_SAMPLE_RATE).toBe(1)
    expect([...LEVELS]).toEqual(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    expect([...NEVER_SAMPLED_OUT]).toEqual(['error', 'fatal'])
  })

  it('reads a configured setting, and ignores one that makes no sense', () => {
    expect(settingsFrom({ minLevel: 'warn', sampleRate: 0.1 })).toEqual({
      minLevel: 'warn',
      sampleRate: 0.1,
    })

    for (const broken of [
      { minLevel: 'verbose' },
      { minLevel: '' },
      { sampleRate: 0 },
      { sampleRate: -1 },
      { sampleRate: 1.5 },
      { sampleRate: Number.NaN },
      {},
    ]) {
      expect(settingsFrom(broken)).toMatchObject({
        minLevel: broken.minLevel === 'warn' ? 'warn' : DEFAULT_MIN_LEVEL,
        sampleRate: DEFAULT_SAMPLE_RATE,
      })
    }
  })
})

describe('the minimum level', () => {
  it('keeps the level it names and everything louder', () => {
    for (const level of ['warn', 'error', 'fatal']) {
      expect(decideIntake(event(level), { minLevel: 'warn', sampleRate: 1 }, 's').keep).toBe(true)
    }
  })

  it('drops everything quieter, and says why', () => {
    for (const level of ['trace', 'debug', 'info']) {
      expect(decideIntake(event(level), { minLevel: 'warn', sampleRate: 1 }, 's')).toEqual({
        keep: false,
        reason: 'below_min_level',
      })
    }
  })

  it('keeps everything at the default', () => {
    for (const level of LEVELS) {
      expect(decideIntake(event(level), WIDE_OPEN, 's').keep).toBe(true)
    }
  })

  it('treats a level it has never heard of as the quietest, rather than letting it through', () => {
    expect(rankOf('verbose')).toBe(0)
    expect(decideIntake(event('verbose'), { minLevel: 'info', sampleRate: 1 }, 's').keep).toBe(
      false,
    )
  })
})

describe('sampling', () => {
  it('never samples out an error or a fatal, however low the rate', () => {
    for (const level of NEVER_SAMPLED_OUT) {
      for (let at = 0; at < 200; at += 1) {
        expect(
          decideIntake(event(level), { minLevel: 'trace', sampleRate: 0.000001 }, `seed-${at}`)
            .keep,
        ).toBe(true)
      }
    }
  })

  it('keeps roughly the share it was asked for', () => {
    let kept = 0
    for (let at = 0; at < 20_000; at += 1) {
      if (decideIntake(event('info'), { minLevel: 'trace', sampleRate: 0.25 }, `s-${at}`).keep) {
        kept += 1
      }
    }

    expect(kept / 20_000).toBeGreaterThan(0.22)
    expect(kept / 20_000).toBeLessThan(0.28)
  })

  it('decides the same way every time for the same event', () => {
    const settings = { minLevel: 'trace', sampleRate: 0.5 }
    const first = decideIntake(event('info'), settings, 'batch:1')

    for (let at = 0; at < 50; at += 1) {
      expect(decideIntake(event('info'), settings, 'batch:1')).toEqual(first)
    }
  })

  it('keeps a whole trace together, which is the point of seeding on the trace id', () => {
    const settings = { minLevel: 'trace', sampleRate: 0.5 }
    const traceId = 'a'.repeat(32)

    const decisions = ['info', 'debug', 'warn'].map(
      (level) =>
        decideIntake(event(level, { trace: { traceId } }), settings, `other-${level}`).keep,
    )

    expect(new Set(decisions).size).toBe(1)
  })

  it('falls back to the session, then to the batch position', () => {
    expect(sampleSeed({ trace: { traceId: 'tr' }, session: { id: 'se' } }, 'fb')).toBe('tr')
    expect(sampleSeed({ session: { id: 'se' } }, 'fb')).toBe('se')
    expect(sampleSeed({}, 'fb')).toBe('fb')
    expect(sampleSeed({ trace: { traceId: '' }, session: { id: '' } }, 'fb')).toBe('fb')
  })

  it('says why it dropped an event, so the count can be reported', () => {
    let dropped = 0
    for (let at = 0; at < 200; at += 1) {
      const decision = decideIntake(
        event('info'),
        { minLevel: 'trace', sampleRate: 0.01 },
        `s${at}`,
      )
      if (!decision.keep) {
        expect(decision.reason).toBe('sampled_out')
        dropped += 1
      }
    }

    expect(dropped).toBeGreaterThan(0)
  })

  it('does no work at all when the rate is one', () => {
    for (let at = 0; at < 100; at += 1) {
      expect(decideIntake(event('trace'), WIDE_OPEN, `s${at}`).keep).toBe(true)
    }
  })

  it('cuts by the level before it samples, so a quiet event is never counted as sampled out', () => {
    expect(
      decideIntake(event('debug'), { minLevel: 'error', sampleRate: 0.0001 }, 's').reason,
    ).toBe('below_min_level')
  })
})

describe('the bucket', () => {
  it('lands inside the range, for anything at all', () => {
    for (const seed of ['', 'a', 'a'.repeat(1000), '🔐', '0'.repeat(32)]) {
      const bucket = bucketOf(seed)
      expect(bucket).toBeGreaterThanOrEqual(0)
      expect(bucket).toBeLessThan(SAMPLE_BUCKETS)
      expect(Number.isInteger(bucket)).toBe(true)
    }
  })

  it('spreads two seeds that differ by one character', () => {
    expect(bucketOf('trace-0001')).not.toBe(bucketOf('trace-0002'))
  })
})
