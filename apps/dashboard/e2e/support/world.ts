import { createHash, randomBytes } from 'node:crypto'
import type { BrowserContext, Page } from '@playwright/test'
import Redis from 'ioredis'
import postgres from 'postgres'
import { BASE_URL, DATABASE_URL, REDIS_URL } from '../../playwright.config'
import { clearMail, codeFromMail } from './mail'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export const PASSWORD = 'a password of a legal length'

let sql: ReturnType<typeof postgres> | undefined
let redis: Redis | undefined

export function database(): ReturnType<typeof postgres> {
  sql ??= postgres(DATABASE_URL, { max: 4, onnotice: () => {} })
  return sql
}

export function store(): Redis {
  redis ??= new Redis(REDIS_URL)
  return redis
}

export async function closeWorld(): Promise<void> {
  await sql?.end()
  redis?.disconnect()
  sql = undefined
  redis = undefined
}

export function newId(prefix: string): string {
  return prefix + Array.from(randomBytes(26), (byte) => CROCKFORD[byte % 32]).join('')
}

export function anAddress(): string {
  return `e2e-${randomBytes(6).toString('hex')}@acme.test`
}

export type Answer = {
  status: number
  body: Record<string, unknown> | null
  retryAfter: string | null
}

export async function api(
  page: Page,
  path: string,
  body?: Record<string, unknown>,
): Promise<Answer> {
  return page.evaluate(
    async (input) => {
      const response = await fetch(input.path, {
        method: input.body === null ? 'GET' : 'POST',
        headers: input.body === null ? {} : { 'content-type': 'application/json' },
        body: input.body === null ? undefined : JSON.stringify(input.body),
      })
      let parsed: unknown = null
      try {
        parsed = await response.json()
      } catch {
        parsed = null
      }
      return {
        status: response.status,
        body: parsed as Record<string, unknown> | null,
        retryAfter: response.headers.get('retry-after'),
      }
    },
    { path, body: body ?? null },
  )
}

export async function openBrowser(context: BrowserContext): Promise<Page> {
  const page = await context.newPage()
  await page.goto(`${BASE_URL}/`)
  return page
}

export async function cookieValue(
  context: BrowserContext,
  name: string,
): Promise<string | undefined> {
  return (await context.cookies(BASE_URL)).find((cookie) => cookie.name === name)?.value
}

export async function anInvitedAddress(
  role: 'admin' | 'member' | 'viewer' = 'member',
): Promise<{ email: string; token: string; organizationId: string }> {
  const email = anAddress()
  const organizationId = newId('org_')
  const token = randomBytes(32).toString('base64url')

  await database().unsafe('insert into organizations (id, name) values ($1, $2)', [
    organizationId,
    'End to end',
  ])
  await database().unsafe(
    `insert into invites (id, organization_id, email, role, token_hash, expires_at)
     values ($1, $2, $3, $5, $4, now() + interval '7 days')`,
    [newId('inv_'), organizationId, email, createHash('sha256').update(token).digest('hex'), role],
  )

  return { email, token, organizationId }
}

export async function anAccount(page: Page): Promise<string> {
  const { email, token } = await anInvitedAddress()
  await clearMail(email)

  const signedUp = await api(page, '/api/auth/signup', {
    invite: token,
    name: 'End To End',
    password: PASSWORD,
    locale: 'en',
  })
  if (signedUp.status !== 200) {
    throw new Error(`signing up answered ${signedUp.status}: ${JSON.stringify(signedUp.body)}`)
  }

  const code = await codeFromMail(email, 'Confirm your e-mail')
  const confirmed = await api(page, '/api/auth/verify-email', { code })
  if (confirmed.status !== 200) {
    throw new Error(`confirming answered ${confirmed.status}: ${JSON.stringify(confirmed.body)}`)
  }

  return email
}

export async function signIn(page: Page, email: string, password = PASSWORD): Promise<Answer> {
  await clearMail(email)
  const started = await api(page, '/api/auth/login/start', { email, password })
  if (started.status !== 200) {
    return started
  }
  const code = await codeFromMail(email, 'Your sign-in code')
  return api(page, '/api/auth/login/verify', { code, remember: true })
}

export async function joinOrganization(
  organizationId: string,
  email: string,
  role: string,
): Promise<string> {
  const id = newId('mem_')
  await database().unsafe(
    `insert into memberships (id, organization_id, user_id, role)
     select $1, $2, id, $4 from users where email = $3`,
    [id, organizationId, email, role],
  )
  return id
}

export async function userIdFor(email: string): Promise<string> {
  const rows = await database().unsafe('select id from users where email = $1', [email])
  const row = rows[0] as { id?: string } | undefined
  if (row?.id === undefined) {
    throw new Error(`no account for ${email}`)
  }
  return row.id
}

export async function forgetTheCodeWait(email: string): Promise<void> {
  await store().del(`otp:cooldown:login:${await userIdFor(email)}`)
}

export async function sessionIdOf(context: BrowserContext): Promise<string> {
  const refresh = await cookieValue(context, '__Host-rt')
  if (refresh === undefined) {
    throw new Error('this browser holds no refresh cookie')
  }
  return refresh.split('.')[0] as string
}
