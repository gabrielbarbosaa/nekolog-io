import type { RateLimiter, RateLimitResult } from '../rate-limiter'

export const DEFAULT_RATE_LIMIT_ENTRIES = 5_000

type Window = {
  startedAt: number
  used: number
}

export type MemoryRateLimiterOptions = {
  maxEntries?: number
  now?: () => number
}

function blocked(retryAfterSeconds: number): RateLimitResult {
  return { allowed: false, remaining: 0, retryAfterSeconds }
}

function isCount(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

export function memoryRateLimiter(options: MemoryRateLimiterOptions = {}): RateLimiter {
  const now = options.now ?? Date.now
  const maxEntries = options.maxEntries ?? DEFAULT_RATE_LIMIT_ENTRIES
  const windows = new Map<string, Window>()

  const evict = (expiredBefore: number): void => {
    if (windows.size <= maxEntries) {
      return
    }
    for (const [key, window] of windows) {
      if (window.startedAt <= expiredBefore) {
        windows.delete(key)
      }
      if (windows.size <= maxEntries) {
        return
      }
    }
    while (windows.size > maxEntries) {
      const oldest = windows.keys().next()
      if (oldest.done) {
        return
      }
      windows.delete(oldest.value)
    }
  }

  return {
    async consume(key, limit, windowSeconds, cost = 1): Promise<RateLimitResult> {
      if (!isCount(limit) || !isCount(cost) || !Number.isFinite(windowSeconds)) {
        return blocked(1)
      }

      const windowMs = Math.max(1, Math.ceil(windowSeconds * 1000))
      const at = now()

      let window = windows.get(key)
      if (window === undefined || at - window.startedAt >= windowMs) {
        window = { startedAt: at, used: 0 }
        windows.set(key, window)
        evict(at - windowMs)
      }

      const endsAt = window.startedAt + windowMs
      if (window.used + cost > limit) {
        return blocked(Math.ceil((endsAt - at) / 1000))
      }

      window.used += cost
      return { allowed: true, remaining: limit - window.used, retryAfterSeconds: 0 }
    },
  }
}
