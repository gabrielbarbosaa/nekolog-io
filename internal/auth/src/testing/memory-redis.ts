import type { RedisClient } from '@nekolog-io/adapters'

export function memoryRedis(): RedisClient {
  const strings = new Map<string, string>()
  const hashes = new Map<string, Map<string, string>>()
  const sets = new Map<string, Set<string>>()

  function run(script: string, keys: readonly string[], args: readonly string[]): unknown {
    if (script.includes("redis.call('INCR', KEYS[1])")) {
      const next = Number(strings.get(keys[0] as string) ?? 0) + 1
      strings.set(keys[0] as string, String(next))
      return next
    }

    if (script.includes("redis.call('SET', KEYS[2], 1, 'NX'")) {
      if (strings.has(keys[1] as string)) {
        return -1
      }
      strings.set(keys[1] as string, '1')
      const sends = Number(strings.get(keys[2] as string) ?? 0) + 1
      strings.set(keys[2] as string, String(sends))
      if (sends > Number(args[4])) {
        return -2
      }
      hashes.set(
        keys[0] as string,
        new Map([
          ['challenge', args[0] as string],
          ['code', args[1] as string],
          ['attempts', '0'],
        ]),
      )
      return 1
    }

    if (script.includes("redis.call('HMGET', KEYS[1], 'challenge', 'code')")) {
      const stored = hashes.get(keys[0] as string)
      if (!stored || stored.get('challenge') !== args[0]) {
        return 0
      }
      if (stored.get('code') === args[1]) {
        hashes.delete(keys[0] as string)
        return 1
      }
      const attempts = Number(stored.get('attempts') ?? 0) + 1
      stored.set('attempts', String(attempts))
      if (attempts >= Number(args[2])) {
        hashes.delete(keys[0] as string)
        return -2
      }
      return -1
    }

    if (script.includes("redis.call('HSET', KEYS[1], 'cur', ARGV[1], 'prev', ''")) {
      hashes.set(
        keys[0] as string,
        new Map([
          ['cur', args[0] as string],
          ['prev', ''],
          ['prevUntil', '0'],
          ['absExp', args[1] as string],
          ['lastUsed', args[2] as string],
          ['userId', args[3] as string],
          ['device', args[4] as string],
          ['country', args[5] as string],
          ['createdAt', args[2] as string],
          ['remember', args[9] as string],
        ]),
      )
      sets.set(keys[1] as string, (sets.get(keys[1] as string) ?? new Set()).add(args[7] as string))
      return 1
    }

    if (script.includes("'cur', 'prev', 'prevUntil', 'absExp', 'userId', 'remember'")) {
      const stored = hashes.get(keys[0] as string)
      const current = stored?.get('cur')
      if (!stored || current === undefined || current === '') {
        return [0, '', '']
      }

      const who = stored.get('userId') ?? ''
      const remembered = stored.get('remember') ?? ''

      if (args[0] === current) {
        const ttl = Math.min(
          Number(args[4]),
          Math.floor((Number(stored.get('absExp')) - Number(args[2])) / 1000),
        )
        if (ttl <= 0) {
          hashes.delete(keys[0] as string)
          return [0, '', '']
        }
        stored.set('cur', args[1] as string)
        stored.set('prev', current)
        stored.set('prevUntil', args[3] as string)
        stored.set('lastUsed', args[2] as string)
        return [1, who, remembered]
      }

      if (args[0] === stored.get('prev') && stored.get('prev') !== '') {
        if (Number(args[2]) <= Number(stored.get('prevUntil'))) {
          return [2, who, remembered]
        }
        hashes.delete(keys[0] as string)
        return [-1, who, '']
      }

      return [0, '', '']
    }

    if (script.includes("local owner = redis.call('HGET', KEYS[1], 'userId')")) {
      const owner = hashes.get(keys[0] as string)?.get('userId')
      hashes.delete(keys[0] as string)
      if (owner !== undefined) {
        sets.get(`sess:user:${owner}`)?.delete(args[0] as string)
      }
      return 1
    }

    if (script.includes("local sids = redis.call('SMEMBERS', KEYS[1])")) {
      const sids = [...(sets.get(keys[0] as string) ?? [])]
      for (const sid of sids) {
        hashes.delete(`sess:${sid}`)
      }
      sets.delete(keys[0] as string)
      return sids.length
    }

    throw new Error(`this fake does not know the script starting ${script.slice(0, 40)}`)
  }

  return {
    get: async (key) => strings.get(key) ?? null,
    set: async (key, value) => {
      strings.set(key, value)
    },
    del: async (key) => {
      strings.delete(key)
      hashes.delete(key)
    },
    incr: async (key) => {
      const next = Number(strings.get(key) ?? 0) + 1
      strings.set(key, String(next))
      return next
    },
    expire: async () => {},
    hset: async () => {},
    hmget: async (key, fields) => fields.map((field) => hashes.get(key)?.get(field) ?? null),
    hincrby: async () => 0,
    eval: async (script, keys, args) => run(script, keys, args),
  }
}
