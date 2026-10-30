export interface RateLimitResult {
  allowed: boolean
  remaining: number
}

export interface RateLimiter {
  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>
}
