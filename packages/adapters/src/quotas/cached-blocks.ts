import type { QuotaStore } from '../quota-store.ts'

export const DEFAULT_BLOCK_CACHE_TTL_MS = 60_000
export const DEFAULT_BLOCK_RETRY_MS = 5_000

export type BlockedEnvironments = {
  isBlocked(environmentId: string): Promise<boolean>
}

export type CachedBlockedEnvironmentsOptions = {
  ttlMs?: number
  retryMs?: number
  now?: () => number
  onError?: (error: unknown) => void
}

export function cachedBlockedEnvironments(
  store: QuotaStore,
  options: CachedBlockedEnvironmentsOptions = {},
): BlockedEnvironments {
  const ttlMs = options.ttlMs ?? DEFAULT_BLOCK_CACHE_TTL_MS
  const retryMs = options.retryMs ?? DEFAULT_BLOCK_RETRY_MS
  const now = options.now ?? Date.now

  let known = new Set<string>()
  let expiresAt = 0
  let inFlight: Promise<Set<string>> | undefined

  const report = (error: unknown): void => {
    try {
      options.onError?.(error)
    } catch {
      return
    }
  }

  const refresh = async (): Promise<Set<string>> => {
    const blocks = await store.blocked()
    return new Set(blocks.map((block) => block.environmentId))
  }

  const current = async (): Promise<Set<string>> => {
    if (expiresAt > now()) {
      return known
    }

    inFlight ??= refresh()
    try {
      known = await inFlight
      expiresAt = now() + ttlMs
    } catch (error) {
      report(error)
      expiresAt = now() + retryMs
    } finally {
      inFlight = undefined
    }

    return known
  }

  return {
    async isBlocked(environmentId) {
      return (await current()).has(environmentId)
    },
  }
}
