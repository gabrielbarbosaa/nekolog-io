import type { RedisClient } from '@nekolog-io/adapters'
import type { SqlRunner } from './users.ts'

export const DEMO_IS_READ_ONLY = 'demo_is_read_only'

export const DEMO_EMAIL = 'demo@nekolog.io'

export const DEMO_SESSIONS_PER_HOUR = 10
export const DEMO_WINDOW_SECONDS = 60 * 60

export type DemoAccount = {
  userId: string
  email: string
  organizationId: string
  organization: string
}

const FIND_DEMO = `
  select users.id as user_id, users.email,
         organizations.id as organization_id, organizations.name
  from users
  join memberships on memberships.user_id = users.id
  join organizations on organizations.id = memberships.organization_id
  where users.is_demo
    and users.suspended_at is null
    and organizations.is_demo
    and organizations.suspended_at is null
  order by users.created_at
  limit 1
`

const IS_DEMO = `select is_demo from users where id = $1 limit 1`

export async function findDemoAccount(run: SqlRunner): Promise<DemoAccount | undefined> {
  const rows = await run(FIND_DEMO, [])
  const row = rows[0]

  return row === undefined
    ? undefined
    : {
        userId: String(row.user_id),
        email: String(row.email),
        organizationId: String(row.organization_id),
        organization: String(row.name),
      }
}

export async function justLooking(run: SqlRunner, userId: string): Promise<boolean> {
  const rows = await run(IS_DEMO, [userId])
  return rows[0]?.is_demo === true
}

export function demoKey(ip: string): string {
  return `demo:opened:${ip}`
}

export type DemoAttempt = { allowed: true } | { allowed: false; retryAfterSeconds: number }

export async function mayOpenADemo(redis: RedisClient, ip: string): Promise<DemoAttempt> {
  const key = demoKey(ip)
  const opened = await redis.incr(key)

  if (opened === 1) {
    await redis.expire(key, DEMO_WINDOW_SECONDS)
  }

  return opened <= DEMO_SESSIONS_PER_HOUR
    ? { allowed: true }
    : { allowed: false, retryAfterSeconds: DEMO_WINDOW_SECONDS }
}
