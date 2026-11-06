import 'server-only'
import { nodeRedis, type RedisClient } from '@nekolog-io/adapters'
import Redis from 'ioredis'

let client: Redis | undefined

export function redisClient(): RedisClient {
  const url = process.env.REDIS_URL
  if (url === undefined || url.trim() === '') {
    throw new Error('REDIS_URL is not set, and no session can be read or renewed without it.')
  }
  client ??= new Redis(url, { lazyConnect: true })
  return nodeRedis(client) as RedisClient
}
