import type { RedisClient } from '../redis-client.ts'

export interface NodeRedisLike {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<unknown>
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>
  del(key: string): Promise<unknown>
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<unknown>
  hset(key: string, fields: Record<string, string>): Promise<unknown>
  hmget(key: string, ...fields: string[]): Promise<Array<string | null>>
  hincrby(key: string, field: string, increment: number): Promise<number>
  evalsha(sha: string, numberOfKeys: number, ...rest: string[]): Promise<unknown>
  eval(script: string, numberOfKeys: number, ...rest: string[]): Promise<unknown>
  script(command: 'LOAD', script: string): Promise<unknown>
}

export function isNoScript(error: unknown): boolean {
  return error instanceof Error && error.message.includes('NOSCRIPT')
}

export function nodeRedis(client: NodeRedisLike): RedisClient {
  const loaded = new Map<string, string>()

  async function shaFor(script: string): Promise<string> {
    const known = loaded.get(script)
    if (known !== undefined) {
      return known
    }
    const sha = String(await client.script('LOAD', script))
    loaded.set(script, sha)
    return sha
  }

  return {
    get: (key) => client.get(key),

    async set(key, value, options) {
      if (options?.exSeconds === undefined) {
        await client.set(key, value)
        return
      }
      await client.set(key, value, 'EX', options.exSeconds)
    },

    async del(key) {
      await client.del(key)
    },

    incr: (key) => client.incr(key),

    async expire(key, seconds) {
      await client.expire(key, seconds)
    },

    async hset(key, fields) {
      await client.hset(key, fields)
    },

    hmget: (key, fields) => client.hmget(key, ...fields),

    hincrby: (key, field, increment) => client.hincrby(key, field, increment),

    async eval(script, keys, args) {
      const rest = [...keys, ...args]
      try {
        return await client.evalsha(await shaFor(script), keys.length, ...rest)
      } catch (error) {
        if (!isNoScript(error)) {
          throw error
        }
        loaded.delete(script)
        return await client.eval(script, keys.length, ...rest)
      }
    },
  }
}
