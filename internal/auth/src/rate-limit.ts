import type { RedisClient } from '@nekolog-io/adapters'
import { COUNT_ATTEMPT } from './scripts.ts'

export const ACCOUNT_ATTEMPTS = 5
export const IP_ATTEMPTS = 20
export const ATTEMPT_WINDOW_SECONDS = 15 * 60
export const BACKOFF_MINUTES: readonly number[] = [1, 2, 4, 8, 15]

export type RateScope = 'login' | 'signup' | 'password-reset'

export type Attempt = { allowed: true } | { allowed: false; retryAfterSeconds: number }

export function limitKey(scope: RateScope, kind: 'account' | 'ip', id: string): string {
  return `rl:${scope}:${kind}:${id}`
}

export function waitAfter(failures: number, allowance: number): number {
  const over = failures - allowance + 1
  if (over <= 0) {
    return 0
  }
  const minutes = BACKOFF_MINUTES[Math.min(over, BACKOFF_MINUTES.length) - 1] as number
  return minutes * 60
}

async function countFailures(redis: RedisClient, key: string, allowance: number): Promise<Attempt> {
  const answer = await redis.eval(
    COUNT_ATTEMPT,
    [key],
    [String(ATTEMPT_WINDOW_SECONDS), String(allowance)],
  )
  const failures = Number(answer)
  const wait = waitAfter(failures, allowance)

  return wait === 0 ? { allowed: true } : { allowed: false, retryAfterSeconds: wait }
}

export async function recordFailure(
  redis: RedisClient,
  scope: RateScope,
  account: string,
  ip: string,
): Promise<void> {
  await countFailures(redis, limitKey(scope, 'account', account), ACCOUNT_ATTEMPTS)
  await countFailures(redis, limitKey(scope, 'ip', ip), IP_ATTEMPTS)
}

export async function mayAttempt(
  redis: RedisClient,
  scope: RateScope,
  account: string,
  ip: string,
): Promise<Attempt> {
  for (const [key, allowance] of [
    [limitKey(scope, 'account', account), ACCOUNT_ATTEMPTS],
    [limitKey(scope, 'ip', ip), IP_ATTEMPTS],
  ] as const) {
    const seen = Number((await redis.get(key)) ?? 0)
    const wait = waitAfter(seen, allowance)
    if (wait > 0) {
      return { allowed: false, retryAfterSeconds: wait }
    }
  }
  return { allowed: true }
}

export async function forgetFailures(
  redis: RedisClient,
  scope: RateScope,
  account: string,
): Promise<void> {
  await redis.del(limitKey(scope, 'account', account))
}
