export interface RedisClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, options?: { exSeconds?: number }): Promise<void>
  del(key: string): Promise<void>
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<void>
  hset(key: string, fields: Record<string, string>): Promise<void>
  hmget(key: string, fields: ReadonlyArray<string>): Promise<ReadonlyArray<string | null>>
  hincrby(key: string, field: string, increment: number): Promise<number>
  eval(script: string, keys: ReadonlyArray<string>, args: ReadonlyArray<string>): Promise<unknown>
}
