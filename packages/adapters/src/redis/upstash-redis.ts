import type { RedisClient } from '../redis-client.ts'
import { isNoScript } from './node-redis.ts'

export interface HttpResponseLike {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export interface HttpRequestLike {
  method: string
  headers: Record<string, string>
  body: string
}

export type FetchLike = (input: string, init: HttpRequestLike) => Promise<HttpResponseLike>

export interface UpstashRedisOptions {
  url: string
  token: string
  fetch?: FetchLike
}

export class UpstashRedisError extends Error {
  constructor(command: string, detail: string) {
    super(`Upstash refused ${command}: ${detail}`)
    this.name = 'UpstashRedisError'
  }
}

const HTTPS_ORIGIN = /^https:\/\/[^/?#\s]+/

export function assertUpstashUrl(url: string): string {
  const found = HTTPS_ORIGIN.exec(url.trim())
  if (found === null) {
    throw new Error(
      `"${url}" cannot be an Upstash endpoint: it has to be an https address, because the token travels with every command.`,
    )
  }
  return found[0]
}

function ambientFetch(): FetchLike {
  const found = (globalThis as { fetch?: FetchLike }).fetch
  if (found === undefined) {
    throw new Error('This runtime has no fetch, so it cannot reach Upstash over HTTP.')
  }
  return found
}

export function upstashRedis(options: UpstashRedisOptions): RedisClient {
  const endpoint = assertUpstashUrl(options.url)
  const send = options.fetch ?? ambientFetch()
  const loaded = new Map<string, string>()

  if (options.token === '') {
    throw new Error('Upstash needs a token; an empty one would send unauthenticated commands.')
  }

  async function command(parts: ReadonlyArray<string | number>): Promise<unknown> {
    const response = await send(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(parts.map(String)),
    })

    const name = String(parts[0] ?? '')
    if (!response.ok) {
      throw new UpstashRedisError(name, `HTTP ${response.status}`)
    }

    const body = (await response.json()) as { result?: unknown; error?: string }
    if (typeof body.error === 'string') {
      throw new UpstashRedisError(name, body.error)
    }
    return body.result
  }

  async function shaFor(script: string): Promise<string> {
    const known = loaded.get(script)
    if (known !== undefined) {
      return known
    }
    const sha = String(await command(['SCRIPT', 'LOAD', script]))
    loaded.set(script, sha)
    return sha
  }

  return {
    async get(key) {
      const result = await command(['GET', key])
      return result === null || result === undefined ? null : String(result)
    },

    async set(key, value, options) {
      await command(
        options?.exSeconds === undefined
          ? ['SET', key, value]
          : ['SET', key, value, 'EX', options.exSeconds],
      )
    },

    async del(key) {
      await command(['DEL', key])
    },

    async incr(key) {
      return Number(await command(['INCR', key]))
    },

    async expire(key, seconds) {
      await command(['EXPIRE', key, seconds])
    },

    async hset(key, fields) {
      const flat = Object.entries(fields).flat()
      if (flat.length === 0) {
        return
      }
      await command(['HSET', key, ...flat])
    },

    async hmget(key, fields) {
      const result = (await command(['HMGET', key, ...fields])) as unknown[]
      return result.map((value) => (value === null || value === undefined ? null : String(value)))
    },

    async hincrby(key, field, increment) {
      return Number(await command(['HINCRBY', key, field, increment]))
    },

    async eval(script, keys, args) {
      try {
        return await command(['EVALSHA', await shaFor(script), keys.length, ...keys, ...args])
      } catch (error) {
        if (!isNoScript(error)) {
          throw error
        }
        loaded.delete(script)
        return await command(['EVAL', script, keys.length, ...keys, ...args])
      }
    },
  }
}
