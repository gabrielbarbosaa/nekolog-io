import type { RedisClient } from '../redis-client.ts'

const PREFIX = /^[a-z][a-z0-9-]{0,30}$/

export function assertPrefix(prefix: string): string {
  if (!PREFIX.test(prefix)) {
    throw new Error(
      `"${prefix}" cannot be a key prefix: use lowercase letters, digits and dashes, starting with a letter.`,
    )
  }
  return prefix
}

export function prefixedRedis(client: RedisClient, prefix: string): RedisClient {
  const namespace = `${assertPrefix(prefix)}:`
  const key = (name: string): string => `${namespace}${name}`

  return {
    get: (name) => client.get(key(name)),
    set: (name, value, options) => client.set(key(name), value, options),
    del: (name) => client.del(key(name)),
    incr: (name) => client.incr(key(name)),
    expire: (name, seconds) => client.expire(key(name), seconds),
    hset: (name, fields) => client.hset(key(name), fields),
    hmget: (name, fields) => client.hmget(key(name), fields),
    hincrby: (name, field, increment) => client.hincrby(key(name), field, increment),
    eval: (script, keys, args) => client.eval(script, keys.map(key), args),
  }
}
