export const LEVELS: readonly string[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']
export const DEFAULT_MIN_LEVEL = 'trace'
export const DEFAULT_SAMPLE_RATE = 1
export const NEVER_SAMPLED_OUT: readonly string[] = ['error', 'fatal']
export const SAMPLE_BUCKETS = 10_000

export type IntakeSettings = {
  minLevel: string
  sampleRate: number
}

export type IntakeDecision = {
  keep: boolean
  reason: 'kept' | 'below_min_level' | 'sampled_out'
}

export function rankOf(level: string): number {
  const at = LEVELS.indexOf(level)
  return at === -1 ? 0 : at
}

export function settingsFrom(record: { minLevel?: string; sampleRate?: number }): IntakeSettings {
  const minLevel =
    record.minLevel !== undefined && LEVELS.includes(record.minLevel)
      ? record.minLevel
      : DEFAULT_MIN_LEVEL

  const sampleRate =
    typeof record.sampleRate === 'number' &&
    Number.isFinite(record.sampleRate) &&
    record.sampleRate > 0 &&
    record.sampleRate <= 1
      ? record.sampleRate
      : DEFAULT_SAMPLE_RATE

  return { minLevel, sampleRate }
}

export function bucketOf(seed: string): number {
  let hash = 2166136261
  for (let at = 0; at < seed.length; at += 1) {
    hash ^= seed.charCodeAt(at)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % SAMPLE_BUCKETS
}

export function sampleSeed(
  event: {
    trace?: { traceId: string } | undefined
    session?: { id?: string } | undefined
  },
  fallback: string,
): string {
  const traceId = event.trace?.traceId
  if (typeof traceId === 'string' && traceId !== '') {
    return traceId
  }
  const sessionId = event.session?.id
  if (typeof sessionId === 'string' && sessionId !== '') {
    return sessionId
  }
  return fallback
}

export function decideIntake(
  event: {
    level: string
    trace?: { traceId: string } | undefined
    session?: { id?: string } | undefined
  },
  settings: IntakeSettings,
  fallbackSeed: string,
): IntakeDecision {
  if (rankOf(event.level) < rankOf(settings.minLevel)) {
    return { keep: false, reason: 'below_min_level' }
  }

  if (settings.sampleRate >= 1 || NEVER_SAMPLED_OUT.includes(event.level)) {
    return { keep: true, reason: 'kept' }
  }

  const kept = bucketOf(sampleSeed(event, fallbackSeed)) < settings.sampleRate * SAMPLE_BUCKETS
  return kept ? { keep: true, reason: 'kept' } : { keep: false, reason: 'sampled_out' }
}
