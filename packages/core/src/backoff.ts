export const DEFAULT_BASE_RETRY_DELAY_MS = 500
export const DEFAULT_MAX_RETRY_DELAY_MS = 30_000
export const DEFAULT_MAX_RETRIES = 5

export type BackoffOptions = {
  baseDelayMs?: number
  maxDelayMs?: number
  random?: () => number
}

export function backoffDelay(attempt: number, options: BackoffOptions = {}): number {
  const base = options.baseDelayMs ?? DEFAULT_BASE_RETRY_DELAY_MS
  const max = options.maxDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS
  const random = options.random ?? Math.random

  const exponential = Math.min(max, base * 2 ** Math.max(0, attempt))
  const jittered = exponential * random()
  return Math.max(0, Math.min(max, Math.round(jittered)))
}

export function parseRetryAfter(header: string | null | undefined, now: number): number | null {
  if (typeof header !== 'string') {
    return null
  }
  const trimmed = header.trim()
  if (trimmed === '') {
    return null
  }

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000
  }

  const at = Date.parse(trimmed)
  if (Number.isNaN(at)) {
    return null
  }
  return Math.max(0, at - now)
}

export type RetryPlan = { kind: 'soon'; delayMs: number } | { kind: 'pause'; delayMs: number }

export function retryPlan(
  attempt: number,
  retryAfter: string | null | undefined,
  now: number,
  options: BackoffOptions = {},
): RetryPlan {
  const max = options.maxDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS
  const fromHeader = parseRetryAfter(retryAfter, now)

  if (fromHeader === null) {
    return { kind: 'soon', delayMs: backoffDelay(attempt, options) }
  }
  if (fromHeader > max) {
    return { kind: 'pause', delayMs: fromHeader }
  }
  return { kind: 'soon', delayMs: fromHeader }
}
