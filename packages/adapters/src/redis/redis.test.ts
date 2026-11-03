import { describe, expect, it } from 'vitest'
import type { RedisClient } from '../redis-client.ts'
import { type NodeRedisLike, nodeRedis } from './node-redis.ts'
import { assertPrefix, prefixedRedis } from './prefixed-redis.ts'
import { UpstashRedisError, upstashRedis } from './upstash-redis.ts'

function recorder(): { calls: Array<[string, ...unknown[]]>; client: RedisClient } {
  const calls: Array<[string, ...unknown[]]> = []
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args])
      return Promise.resolve(null as never)
    }

  return {
    calls,
    client: {
      get: record('get'),
      set: record('set'),
      del: record('del'),
      incr: record('incr'),
      expire: record('expire'),
      hset: record('hset'),
      hmget: record('hmget'),
      hincrby: record('hincrby'),
      eval: record('eval'),
    },
  }
}

describe('the prefix that keeps one environment out of another', () => {
  it.each(['dev', 'qa', 'prod', 'preview-7'])('accepts %s', (prefix) => {
    expect(assertPrefix(prefix)).toBe(prefix)
  })

  it.each(['', 'Dev', '7dev', 'dev:', 'dev prod', 'a'.repeat(32)])('refuses %s', (prefix) => {
    expect(() => assertPrefix(prefix)).toThrow(/cannot be a key prefix/)
  })

  it('prefixes every key the caller names', async () => {
    const { calls, client } = recorder()
    const redis = prefixedRedis(client, 'qa')

    await redis.get('sess:abc')
    await redis.set('otp:login:1', 'x', { exSeconds: 60 })
    await redis.del('sess:abc')
    await redis.incr('sends')
    await redis.expire('sends', 3600)
    await redis.hset('otp:login:1', { code: 'h' })
    await redis.hmget('otp:login:1', ['code'])
    await redis.hincrby('otp:login:1', 'attempts', 1)

    expect(calls.map(([name, key]) => [name, key])).toEqual([
      ['get', 'qa:sess:abc'],
      ['set', 'qa:otp:login:1'],
      ['del', 'qa:sess:abc'],
      ['incr', 'qa:sends'],
      ['expire', 'qa:sends'],
      ['hset', 'qa:otp:login:1'],
      ['hmget', 'qa:otp:login:1'],
      ['hincrby', 'qa:otp:login:1'],
    ])
  })

  it('prefixes the KEYS a script reads, and leaves its arguments alone', async () => {
    const { calls, client } = recorder()

    await prefixedRedis(client, 'prod').eval('return 1', ['otp:a', 'otp:b'], ['otp:a', '60'])

    expect(calls[0]).toEqual(['eval', 'return 1', ['prod:otp:a', 'prod:otp:b'], ['otp:a', '60']])
  })

  it('keeps two environments apart for the same key name', async () => {
    const { calls, client } = recorder()

    await prefixedRedis(client, 'dev').get('sess:1')
    await prefixedRedis(client, 'prod').get('sess:1')

    expect(calls[0]?.[1]).not.toBe(calls[1]?.[1])
  })
})

function upstashFake(replies: unknown[]): {
  requests: Array<{ body: unknown[]; authorization: string | undefined }>
  client: RedisClient
} {
  const requests: Array<{ body: unknown[]; authorization: string | undefined }> = []
  let next = 0

  const client = upstashRedis({
    url: 'https://eu1.upstash.io',
    token: 'a-token',
    fetch: async (_input, init) => {
      const headers = init.headers as Record<string, string>
      requests.push({
        body: JSON.parse(String(init.body)) as unknown[],
        authorization: headers.authorization,
      })
      const reply = replies[next] ?? { result: null }
      next += 1
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(reply),
      }
    },
  })

  return { requests, client }
}

describe('the Upstash client', () => {
  it('refuses an endpoint that is not https, because the token rides along', () => {
    expect(() => upstashRedis({ url: 'http://eu1.upstash.io', token: 't' })).toThrow(/https/)
  })

  it('refuses an empty token instead of sending commands unauthenticated', () => {
    expect(() => upstashRedis({ url: 'https://eu1.upstash.io', token: '' })).toThrow(/token/)
  })

  it('sends the command as an array, with the token', async () => {
    const { requests, client } = upstashFake([{ result: 'ok' }])

    await client.set('sess:1', 'v', { exSeconds: 30 })

    expect(requests[0]?.body).toEqual(['SET', 'sess:1', 'v', 'EX', '30'])
    expect(requests[0]?.authorization).toBe('Bearer a-token')
  })

  it('turns an error reply into a thrown error, naming the command', async () => {
    const { client } = upstashFake([{ error: 'WRONGTYPE Operation against a key' }])

    await expect(client.incr('sess:1')).rejects.toBeInstanceOf(UpstashRedisError)
  })

  it('loads a script once and then calls it by hash', async () => {
    const { requests, client } = upstashFake([{ result: 'sha1' }, { result: 1 }, { result: 1 }])

    await client.eval('return 1', ['a'], ['b'])
    await client.eval('return 1', ['a'], ['b'])

    expect(requests.map((request) => request.body[0])).toEqual(['SCRIPT', 'EVALSHA', 'EVALSHA'])
  })

  it('falls back to sending the script when the server forgot it', async () => {
    const { requests, client } = upstashFake([
      { result: 'sha1' },
      { error: 'NOSCRIPT No matching script' },
      { result: 7 },
    ])

    expect(await client.eval('return 7', ['a'], [])).toBe(7)
    expect(requests.map((request) => request.body[0])).toEqual(['SCRIPT', 'EVALSHA', 'EVAL'])
  })

  it('reads a missing key as null, not as the string "null"', async () => {
    const { client } = upstashFake([{ result: null }])

    expect(await client.get('sess:gone')).toBeNull()
  })
})

describe('the self-host client', () => {
  function nodeFake(onEvalsha: () => unknown): { calls: string[]; client: RedisClient } {
    const calls: string[] = []
    const fake = {
      script: async (_command: 'LOAD', _script: string) => {
        calls.push('script')
        return 'sha1'
      },
      evalsha: async () => {
        calls.push('evalsha')
        return onEvalsha()
      },
      eval: async () => {
        calls.push('eval')
        return 9
      },
    } as unknown as NodeRedisLike

    return { calls, client: nodeRedis(fake) }
  }

  it('loads a script once and then calls it by hash', async () => {
    const { calls, client } = nodeFake(() => 1)

    await client.eval('return 1', ['a'], [])
    await client.eval('return 1', ['a'], [])

    expect(calls).toEqual(['script', 'evalsha', 'evalsha'])
  })

  it('falls back to sending the script when the server forgot it', async () => {
    const { calls, client } = nodeFake(() => {
      throw new Error('NOSCRIPT No matching script')
    })

    expect(await client.eval('return 9', ['a'], [])).toBe(9)
    expect(calls).toEqual(['script', 'evalsha', 'eval'])
  })

  it('does not swallow an error that is not about a missing script', async () => {
    const { client } = nodeFake(() => {
      throw new Error('READONLY You cannot write against a read only replica')
    })

    await expect(client.eval('return 1', ['a'], [])).rejects.toThrow(/READONLY/)
  })
})
