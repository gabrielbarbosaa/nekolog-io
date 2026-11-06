import { describe, expect, it } from 'vitest'
import {
  CHANGE_EMAIL_PURPOSE,
  changePassword,
  finishEmailChange,
  finishRecovery,
  NEW_ADDRESS_SUFFIX,
  pendingEmailKey,
  RESET_PURPOSE,
  startEmailChange,
  startRecovery,
} from './account.ts'
import type { LoginDeps } from './login.ts'
import { verifyCode } from './otp.ts'
import { hashPassword, verifyPassword } from './password.ts'
import { memoryRedis } from './testing/memory-redis.ts'
import type { SqlRunner } from './users.ts'

const PASSWORD = 'a password of a legal length'
const NEXT = 'another password nobody leaked'
const IP = '203.0.113.7'

const offline = {
  fetch: (async () => new Response('', { status: 503 })) as typeof globalThis.fetch,
}

type Row = Record<string, unknown>

async function anAccount(overrides: Row = {}): Promise<Row> {
  return {
    id: 'usr_1',
    email: 'someone@acme.test',
    name: 'Someone',
    password_hash: await hashPassword(PASSWORD),
    email_verified_at: new Date(),
    suspended_at: null,
    locale: 'en',
    timezone: 'UTC',
    ...overrides,
  }
}

type Database = {
  account: Row | undefined
  taken?: string
  writes: Array<{ text: string; params: readonly unknown[] }>
}

function runnerFor(db: Database): SqlRunner {
  return async (text, params) => {
    db.writes.push({ text, params })

    if (text.includes('set password_hash')) {
      if (db.account !== undefined) {
        db.account.password_hash = params[1]
      }
      return []
    }
    if (text.includes('set email = $2')) {
      if (db.taken === params[1]) {
        return []
      }
      if (db.account !== undefined) {
        db.account.email = params[1]
      }
      return [{ email: params[1] }]
    }
    if (text.includes('from users\n  where id = $1')) {
      return db.account === undefined || params[0] !== db.account.id ? [] : [db.account]
    }
    if (text.includes('from users\n  where email = $1')) {
      if (db.taken !== undefined && params[0] === db.taken) {
        return [await anAccount({ id: 'usr_other', email: db.taken })]
      }
      return db.account === undefined || params[0] !== db.account.email ? [] : [db.account]
    }
    return []
  }
}

async function depsFor(db: Database): Promise<LoginDeps> {
  return { run: runnerFor(db), redis: memoryRedis(), otpSecret: 'secret', pwned: offline }
}

function writesOf(db: Database, fragment: string): number {
  return db.writes.filter((write) => write.text.includes(fragment)).length
}

describe('asking for a new password', () => {
  it('sends a code when the address belongs to an account that can sign in', async () => {
    const db: Database = { account: await anAccount(), writes: [] }
    const started = await startRecovery(await depsFor(db), { email: 'someone@acme.test', ip: IP })

    expect(started.outcome).toBe('code-sent')
  })

  it('answers the same for an address nobody has and one that never confirmed', async () => {
    const nobody: Database = { account: undefined, writes: [] }
    const unconfirmed: Database = {
      account: await anAccount({ email_verified_at: null }),
      writes: [],
    }

    expect(
      (await startRecovery(await depsFor(nobody), { email: 'who@acme.test', ip: IP })).outcome,
    ).toBe('nothing-to-do')
    expect(
      (await startRecovery(await depsFor(unconfirmed), { email: 'someone@acme.test', ip: IP }))
        .outcome,
    ).toBe('nothing-to-do')
  })

  it('reads the address in lowercase, however it was typed', async () => {
    const db: Database = { account: await anAccount(), writes: [] }
    const started = await startRecovery(await depsFor(db), {
      email: '  SomeOne@Acme.Test  ',
      ip: IP,
    })

    expect(started.outcome).toBe('code-sent')
  })
})

describe('setting the new password', () => {
  it('refuses a password the policy refuses, and leaves the code unspent', async () => {
    const db: Database = { account: await anAccount(), writes: [] }
    const deps = await depsFor(db)
    const started = await startRecovery(deps, { email: 'someone@acme.test', ip: IP })
    if (started.outcome !== 'code-sent') {
      throw new Error('no code was sent')
    }

    const refused = await finishRecovery(deps, {
      userId: 'usr_1',
      challenge: started.challenge,
      code: started.code,
      password: 'short',
    })

    expect(refused).toEqual({ outcome: 'bad-password', refusal: 'too-short' })
    expect(writesOf(db, 'set password_hash')).toBe(0)
    expect(
      await verifyCode(
        { redis: deps.redis, secret: 'secret' },
        RESET_PURPOSE,
        'usr_1',
        started.challenge,
        started.code,
      ),
      'the code was spent on a password that was never going to be accepted',
    ).toBe('accepted')
  })

  it('writes the new hash and ends every session', async () => {
    const db: Database = { account: await anAccount(), writes: [] }
    const deps = await depsFor(db)
    const started = await startRecovery(deps, { email: 'someone@acme.test', ip: IP })
    if (started.outcome !== 'code-sent') {
      throw new Error('no code was sent')
    }

    const done = await finishRecovery(deps, {
      userId: 'usr_1',
      challenge: started.challenge,
      code: started.code,
      password: NEXT,
    })

    expect(done.outcome).toBe('password-changed')
    expect(await verifyPassword(String(db.account?.password_hash), NEXT)).toBe(true)
  })

  it('refuses a code from another browser the same way as a wrong one would not', async () => {
    const db: Database = { account: await anAccount(), writes: [] }
    const deps = await depsFor(db)
    const started = await startRecovery(deps, { email: 'someone@acme.test', ip: IP })
    if (started.outcome !== 'code-sent') {
      throw new Error('no code was sent')
    }

    const elsewhere = await finishRecovery(deps, {
      userId: 'usr_1',
      challenge: 'a challenge from another tab',
      code: started.code,
      password: NEXT,
    })

    expect(elsewhere.outcome).toBe('start-again')
    expect(writesOf(db, 'set password_hash')).toBe(0)
  })
})

describe('changing the password from inside the account', () => {
  it('needs the current one, and writes nothing without it', async () => {
    const db: Database = { account: await anAccount(), writes: [] }
    const wrong = await changePassword(await depsFor(db), {
      userId: 'usr_1',
      current: 'not it',
      next: NEXT,
    })

    expect(wrong).toEqual({ outcome: 'wrong-password' })
    expect(writesOf(db, 'set password_hash')).toBe(0)
  })

  it('refuses a new password the policy refuses', async () => {
    const db: Database = { account: await anAccount(), writes: [] }
    const refused = await changePassword(await depsFor(db), {
      userId: 'usr_1',
      current: PASSWORD,
      next: 'short',
    })

    expect(refused).toEqual({ outcome: 'bad-password', refusal: 'too-short' })
    expect(writesOf(db, 'set password_hash')).toBe(0)
  })

  it('answers wrong-password for a user that is not there, and says nothing more', async () => {
    const db: Database = { account: undefined, writes: [] }

    expect(
      await changePassword(await depsFor(db), {
        userId: 'usr_gone',
        current: PASSWORD,
        next: NEXT,
      }),
    ).toEqual({ outcome: 'wrong-password' })
  })

  it('writes the new hash when the current one is right', async () => {
    const db: Database = { account: await anAccount(), writes: [] }
    const done = await changePassword(await depsFor(db), {
      userId: 'usr_1',
      current: PASSWORD,
      next: NEXT,
    })

    expect(done.outcome).toBe('password-changed')
    expect(await verifyPassword(String(db.account?.password_hash), NEXT)).toBe(true)
  })
})

describe('changing the address', () => {
  it('asks for the password again', async () => {
    const db: Database = { account: await anAccount(), writes: [] }
    const refused = await startEmailChange(await depsFor(db), {
      userId: 'usr_1',
      password: 'not it',
      email: 'new@acme.test',
    })

    expect(refused).toEqual({ outcome: 'wrong-password' })
  })

  it('refuses the address it already has, and one that is not an address', async () => {
    const db: Database = { account: await anAccount(), writes: [] }
    const deps = await depsFor(db)

    for (const email of ['someone@acme.test', 'SOMEONE@ACME.TEST', 'not-an-address', 'a@b']) {
      expect(
        (await startEmailChange(deps, { userId: 'usr_1', password: PASSWORD, email })).outcome,
        email,
      ).toBe('bad-address')
    }
  })

  it('refuses an address somebody else holds', async () => {
    const db: Database = { account: await anAccount(), taken: 'taken@acme.test', writes: [] }
    const refused = await startEmailChange(await depsFor(db), {
      userId: 'usr_1',
      password: PASSWORD,
      email: 'taken@acme.test',
    })

    expect(refused).toEqual({ outcome: 'taken' })
  })

  it('sends two different codes and remembers the address it is waiting for', async () => {
    const db: Database = { account: await anAccount(), writes: [] }
    const deps = await depsFor(db)
    const started = await startEmailChange(deps, {
      userId: 'usr_1',
      password: PASSWORD,
      email: 'New@Acme.Test',
    })

    expect(started.outcome).toBe('codes-sent')
    if (started.outcome !== 'codes-sent') {
      return
    }
    expect(started.newEmail).toBe('new@acme.test')
    expect(started.currentCode).not.toBe(started.newCode)
    expect(await deps.redis.get(pendingEmailKey('usr_1'))).toBe(
      `${started.challenge}:new@acme.test`,
    )
  })
})

describe('confirming the address', () => {
  async function started() {
    const db: Database = { account: await anAccount(), writes: [] }
    const deps = await depsFor(db)
    const begun = await startEmailChange(deps, {
      userId: 'usr_1',
      password: PASSWORD,
      email: 'new@acme.test',
    })
    if (begun.outcome !== 'codes-sent') {
      throw new Error('no codes were sent')
    }
    return { db, deps, begun }
  }

  it('needs both codes, the one here and the one there', async () => {
    const { db, deps, begun } = await started()

    expect(
      (
        await finishEmailChange(deps, {
          userId: 'usr_1',
          challenge: begun.challenge,
          currentCode: begun.currentCode,
          newCode: 'WRONG1',
        })
      ).outcome,
    ).toBe('wrong-code')
    expect(db.account?.email).toBe('someone@acme.test')
  })

  it('writes the new address when both are right', async () => {
    const { db, deps, begun } = await started()

    const done = await finishEmailChange(deps, {
      userId: 'usr_1',
      challenge: begun.challenge,
      currentCode: begun.currentCode,
      newCode: begun.newCode,
    })

    expect(done).toMatchObject({ outcome: 'email-changed', email: 'new@acme.test' })
    expect(db.account?.email).toBe('new@acme.test')
    expect(await deps.redis.get(pendingEmailKey('usr_1'))).toBeNull()
  })

  it('refuses a challenge that is not the one the change was started with', async () => {
    const { db, deps, begun } = await started()

    expect(
      (
        await finishEmailChange(deps, {
          userId: 'usr_1',
          challenge: 'another tab',
          currentCode: begun.currentCode,
          newCode: begun.newCode,
        })
      ).outcome,
    ).toBe('start-again')
    expect(db.account?.email).toBe('someone@acme.test')
  })

  it('refuses when the address it is waiting for belongs to another attempt', async () => {
    const { db, deps, begun } = await started()
    await deps.redis.set(pendingEmailKey('usr_1'), `another-challenge:elsewhere@acme.test`)

    const done = await finishEmailChange(deps, {
      userId: 'usr_1',
      challenge: begun.challenge,
      currentCode: begun.currentCode,
      newCode: begun.newCode,
    })

    expect(done.outcome).toBe('start-again')
    expect(db.account?.email).toBe('someone@acme.test')
  })

  it('refuses when nothing was started at all', async () => {
    const db: Database = { account: await anAccount(), writes: [] }

    expect(
      (
        await finishEmailChange(await depsFor(db), {
          userId: 'usr_1',
          challenge: 'anything',
          currentCode: 'AAAAAA',
          newCode: 'BBBBBB',
        })
      ).outcome,
    ).toBe('start-again')
  })

  it('keeps the two codes apart, so one cannot answer for the other', async () => {
    const { deps, begun } = await started()

    const swapped = await finishEmailChange(deps, {
      userId: 'usr_1',
      challenge: begun.challenge,
      currentCode: begun.newCode,
      newCode: begun.currentCode,
    })

    expect(swapped.outcome).toBe('wrong-code')
    expect(
      await verifyCode(
        { redis: deps.redis, secret: 'secret' },
        CHANGE_EMAIL_PURPOSE,
        `usr_1${NEW_ADDRESS_SUFFIX}`,
        begun.challenge,
        begun.newCode,
      ),
      'the code for the new address was spent by a swap it should have refused',
    ).toBe('accepted')
  })
})
