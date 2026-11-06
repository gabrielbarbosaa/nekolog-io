import type { RedisClient } from '@nekolog-io/adapters'
import { type CodePurpose, newChallenge } from './codes.ts'
import { issueCode, type OtpStore, verifyCode } from './otp.ts'
import { spendTheSameTime, verifyPassword } from './password.ts'
import type { PwnedOptions } from './pwned.ts'
import { forgetFailures, mayAttempt, recordFailure } from './rate-limit.ts'
import { createSession, type Device, type Session, type SessionStore } from './sessions.ts'
import { type Account, findAccountByEmail, mayHoldASession, type SqlRunner } from './users.ts'

export const LOGIN_PURPOSE: CodePurpose = 'login'

export type LoginDeps = {
  run: SqlRunner
  redis: RedisClient
  otpSecret: string
  pwned?: PwnedOptions
}

export type StartInput = {
  email: string
  password: string
  ip: string
}

export type Started =
  | { outcome: 'code-sent'; challenge: string; account: Account; code: string }
  | { outcome: 'refused' }
  | { outcome: 'slow-down'; retryAfterSeconds: number }

export type VerifyInput = {
  userId: string
  challenge: string
  code: string
  remember: boolean
} & Device

export type Finished =
  | { outcome: 'signed-in'; session: Session }
  | { outcome: 'wrong-code' }
  | { outcome: 'start-again' }

function stores(deps: LoginDeps): { otp: OtpStore; sessions: SessionStore } {
  return { otp: { redis: deps.redis, secret: deps.otpSecret }, sessions: { redis: deps.redis } }
}

export async function startLogin(deps: LoginDeps, input: StartInput): Promise<Started> {
  const allowed = await mayAttempt(deps.redis, 'login', input.email.toLowerCase(), input.ip)
  if (!allowed.allowed) {
    return { outcome: 'slow-down', retryAfterSeconds: allowed.retryAfterSeconds }
  }

  const account = await findAccountByEmail(deps.run, input.email)

  if (account === undefined) {
    await spendTheSameTime(input.password)
    await recordFailure(deps.redis, 'login', input.email.toLowerCase(), input.ip)
    return { outcome: 'refused' }
  }

  const correct = await verifyPassword(account.passwordHash, input.password)
  if (!correct || !mayHoldASession(account)) {
    await recordFailure(deps.redis, 'login', input.email.toLowerCase(), input.ip)
    return { outcome: 'refused' }
  }

  const challenge = newChallenge()
  const issued = await issueCode(stores(deps).otp, LOGIN_PURPOSE, account.id, challenge)

  if (issued.outcome !== 'issued') {
    return { outcome: 'refused' }
  }

  await forgetFailures(deps.redis, 'login', input.email.toLowerCase())
  return { outcome: 'code-sent', challenge, account, code: issued.code }
}

export async function finishLogin(deps: LoginDeps, input: VerifyInput): Promise<Finished> {
  const read = await verifyCode(
    stores(deps).otp,
    LOGIN_PURPOSE,
    input.userId,
    input.challenge,
    input.code,
  )

  if (read === 'accepted') {
    const session = await createSession(stores(deps).sessions, {
      userId: input.userId,
      remember: input.remember,
      device: input.device,
      country: input.country,
    })
    return { outcome: 'signed-in', session }
  }

  return read === 'wrong' ? { outcome: 'wrong-code' } : { outcome: 'start-again' }
}

export async function resendCode(
  deps: LoginDeps,
  userId: string,
  challenge: string,
): Promise<{ outcome: 'code-sent'; code: string } | { outcome: 'wait' }> {
  const issued = await issueCode(stores(deps).otp, LOGIN_PURPOSE, userId, challenge)

  return issued.outcome === 'issued'
    ? { outcome: 'code-sent', code: issued.code }
    : { outcome: 'wait' }
}
