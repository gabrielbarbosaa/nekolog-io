export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

export interface RateLimiter {
  consume(
    key: string,
    limit: number,
    windowSeconds: number,
    cost?: number,
  ): Promise<RateLimitResult>
}
