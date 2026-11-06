import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nodeRedis, type RedisClient } from '@nekolog-io/adapters'
import Redis from 'ioredis'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  changePassword,
  finishEmailChange,
  finishRecovery,
  startEmailChange,
  startRecovery,
} from './account.ts'
import type { LoginDeps } from './login.ts'
import { hashPassword, verifyPassword } from './password.ts'
import { createSession, listSessions, sessionLives } from './sessions.ts'
import { newId, USER_ID_PREFIX } from './signup.ts'
import { findAccountById, type SqlRunner } from './users.ts'

const POSTGRES =
  process.env.POSTGRES_TEST_URL ?? 'postgres://nekolog:nekolog@localhost:5432/nekolog_dev'
const REDIS = process.env.REDIS_TEST_URL ?? 'redis://localhost:6379'

const PASSWORD = 'a password of a legal length'
const NEXT = 'a different password nobody leaked'
const IP = '203.0.113.9'

const offline = {
  fetch: (async () => new Response('', { status: 503 })) as typeof globalThis.fetch,
}

async function postgresAnswers(): Promise<boolean> {
  const probe = postgres(POSTGRES, { max: 1, connect_timeout: 2, onnotice: () => {} })
  try {
    await probe.unsafe('select 1')
    return true
  } catch {
    return false
  } finally {
    await probe.end({ timeout: 1 })
  }
}

async function redisAnswers(): Promise<boolean> {
  const probe = new Redis(REDIS, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  })
  try {
    await probe.connect()
    await probe.ping()
    return true
  } catch {
    return false
  } finally {
    probe.disconnect()
  }
}

const reachable = (await postgresAnswers()) && (await redisAnswers())

if (!reachable) {
  if (process.env.POSTGRES_TEST_REQUIRED === '1' || process.env.REDIS_TEST_REQUIRED === '1') {
    throw new Error(
      `The account tests need both ${POSTGRES} and ${REDIS}, and one of them did not answer.`,
    )
  }
  process.stderr.write(
    '\nSkipping the account integration tests: Postgres or Redis did not answer.\n' +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'db',
  'migrations',
)

const DATABASE = `nekolog_account_${process.pid}`

function migrationStatements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .flatMap((file) =>
      readFileSync(join(MIGRATIONS, file), 'utf8').split('--> statement-breakpoint'),
    )
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '')
}

let sql: ReturnType<typeof postgres>
let raw: Redis
let redis: RedisClient
let run: SqlRunner

function deps(): LoginDeps {
  return { run, redis, otpSecret: 'secret-for-the-tests', pwned: offline }
}

function address(): string {
  return `account-${randomBytes(5).toString('hex')}@acme.test`
}

async function anAccount(
  overrides: { confirmed?: boolean; suspended?: boolean } = {},
): Promise<{ id: string; email: string }> {
  const id = newId(USER_ID_PREFIX)
  const email = address()
  await sql.unsafe(
    `insert into users (id, name, email, password_hash, email_verified_at, suspended_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      'Account',
      email,
      await hashPassword(PASSWORD),
      overrides.confirmed === false ? null : new Date(),
      overrides.suspended === true ? new Date() : null,
    ],
  )
  return { id, email }
}

beforeAll(async () => {
  if (!reachable) {
    return
  }

  const admin = postgres(POSTGRES, { max: 1, onnotice: () => {} })
  try {
    await admin.unsafe(`create database "${DATABASE}"`)
  } finally {
    await admin.end()
  }

  sql = postgres(POSTGRES.replace(/\/[^/]*$/, `/${DATABASE}`), { max: 2, onnotice: () => {} })
  for (const statement of migrationStatements()) {
    await sql.unsafe(statement)
  }

  run = async (text, params) =>
    (await sql.unsafe(text, params as never[])) as unknown as ReadonlyArray<Record<string, unknown>>

  raw = new Redis(REDIS)
  redis = nodeRedis(raw) as RedisClient
}, 60_000)

afterAll(async () => {
  if (!reachable) {
    return
  }

  raw?.disconnect()
  await sql?.end()
  const admin = postgres(POSTGRES, { max: 1, onnotice: () => {} })
  try {
    await admin.unsafe(`drop database if exists "${DATABASE}" with (force)`)
  } finally {
    await admin.end()
  }
})

describe.skipIf(!reachable)('recovering a password against the real tables', () => {
  it('writes a hash the new password verifies against and the old one does not', async () => {
    const account = await anAccount()
    const started = await startRecovery(deps(), { email: account.email, ip: IP })
    if (started.outcome !== 'code-sent') {
      throw new Error(`expected a code, got ${started.outcome}`)
    }

    const done = await finishRecovery(deps(), {
      userId: account.id,
      challenge: started.challenge,
      code: started.code,
      password: NEXT,
    })

    expect(done.outcome).toBe('password-changed')
    const after = await findAccountById(run, account.id)
    expect(await verifyPassword(String(after?.passwordHash), NEXT)).toBe(true)
    expect(await verifyPassword(String(after?.passwordHash), PASSWORD)).toBe(false)
  })

  it('ends every session of that account and leaves another person alone', async () => {
    const mine = await anAccount()
    const theirs = await anAccount()
    const here = await createSession(
      { redis },
      { userId: mine.id, remember: true, device: 'Firefox', country: 'BR' },
    )
    const there = await createSession(
      { redis },
      { userId: mine.id, remember: false, device: 'Safari', country: 'BR' },
    )
    const stranger = await createSession(
      { redis },
      { userId: theirs.id, remember: true, device: 'Firefox', country: 'BR' },
    )

    const started = await startRecovery(deps(), { email: mine.email, ip: IP })
    if (started.outcome !== 'code-sent') {
      throw new Error(`expected a code, got ${started.outcome}`)
    }
    const done = await finishRecovery(deps(), {
      userId: mine.id,
      challenge: started.challenge,
      code: started.code,
      password: NEXT,
    })

    expect(done).toMatchObject({ outcome: 'password-changed', sessionsEnded: 2 })
    expect(await sessionLives({ redis }, here.sid)).toBe(false)
    expect(await sessionLives({ redis }, there.sid)).toBe(false)
    expect(await sessionLives({ redis }, stranger.sid)).toBe(true)
  })

  it('sends nothing for an account that never confirmed, or one that is suspended', async () => {
    const unconfirmed = await anAccount({ confirmed: false })
    const suspended = await anAccount({ suspended: true })

    for (const account of [unconfirmed, suspended]) {
      expect(
        (await startRecovery(deps(), { email: account.email, ip: IP })).outcome,
        account.email,
      ).toBe('nothing-to-do')
    }
  })
})

describe.skipIf(!reachable)('changing a password from inside the account', () => {
  it('ends every session, so the plan is followed and not just written down', async () => {
    const account = await anAccount()
    const session = await createSession(
      { redis },
      { userId: account.id, remember: true, device: 'Firefox', country: 'BR' },
    )

    const done = await changePassword(deps(), {
      userId: account.id,
      current: PASSWORD,
      next: NEXT,
    })

    expect(done.outcome).toBe('password-changed')
    expect(await sessionLives({ redis }, session.sid)).toBe(false)
  })
})

describe.skipIf(!reachable)('changing the address against the real unique index', () => {
  it('moves the account to the new address and confirms it', async () => {
    const account = await anAccount()
    const wanted = address()

    const started = await startEmailChange(deps(), {
      userId: account.id,
      password: PASSWORD,
      email: wanted,
    })
    if (started.outcome !== 'codes-sent') {
      throw new Error(`expected two codes, got ${started.outcome}`)
    }

    const done = await finishEmailChange(deps(), {
      userId: account.id,
      challenge: started.challenge,
      currentCode: started.currentCode,
      newCode: started.newCode,
    })

    expect(done).toMatchObject({ outcome: 'email-changed', email: wanted })
    const after = await findAccountById(run, account.id)
    expect(after?.email).toBe(wanted)
    expect(after?.emailVerifiedAt).toBeInstanceOf(Date)
  })

  it('refuses an address another account already holds', async () => {
    const account = await anAccount()
    const other = await anAccount()

    expect(
      await startEmailChange(deps(), {
        userId: account.id,
        password: PASSWORD,
        email: other.email,
      }),
    ).toEqual({ outcome: 'taken' })
  })

  it('refuses it in the database too, not only in the check before', async () => {
    const account = await anAccount()
    const other = await anAccount()
    const wanted = address()

    const started = await startEmailChange(deps(), {
      userId: account.id,
      password: PASSWORD,
      email: wanted,
    })
    if (started.outcome !== 'codes-sent') {
      throw new Error(`expected two codes, got ${started.outcome}`)
    }

    await sql.unsafe('update users set email = $2 where id = $1', [other.id, wanted])

    const done = await finishEmailChange(deps(), {
      userId: account.id,
      challenge: started.challenge,
      currentCode: started.currentCode,
      newCode: started.newCode,
    })

    expect(done).toEqual({ outcome: 'taken' })
    expect((await findAccountById(run, account.id))?.email).toBe(account.email)
  })
})

describe.skipIf(!reachable)('the sessions a person can see', () => {
  it('lists one row per live session, newest use first', async () => {
    const account = await anAccount()
    const older = await createSession(
      { redis },
      {
        userId: account.id,
        remember: true,
        device: 'Safari on macOS',
        country: 'PT',
        now: Date.now() - 60_000,
      },
    )
    const newer = await createSession(
      { redis },
      { userId: account.id, remember: true, device: 'Firefox on Linux', country: 'BR' },
    )

    const listed = await listSessions({ redis }, account.id)

    expect(listed.map((row) => row.sid)).toEqual([newer.sid, older.sid])
    expect(listed[0]).toMatchObject({ device: 'Firefox on Linux', country: 'BR' })
    expect(listed[1]?.createdAt).toBeLessThan(listed[0]?.createdAt ?? 0)
  })

  it('never shows a token or a hash of one', async () => {
    const account = await anAccount()
    const session = await createSession(
      { redis },
      { userId: account.id, remember: true, device: 'Firefox', country: 'BR' },
    )

    const listed = await listSessions({ redis }, account.id)
    const written = JSON.stringify(listed)

    expect(written).not.toContain(session.refreshToken.split('.')[1] as string)
    expect(written).not.toMatch(/[0-9a-f]{64}/)
  })
})
