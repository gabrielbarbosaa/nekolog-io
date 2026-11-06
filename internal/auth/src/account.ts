import { newChallenge } from './codes.ts'
import type { LoginDeps } from './login.ts'
import { CODE_TTL_SECONDS, forgetCode, issueCode, type OtpStore, verifyCode } from './otp.ts'
import { hashPassword, verifyPassword } from './password.ts'
import { checkPassword, type PasswordRefusal } from './policy.ts'
import { forgetFailures, mayAttempt, recordFailure } from './rate-limit.ts'
import { revokeEverySession, type SessionStore } from './sessions.ts'
import {
  type Account,
  findAccountByEmail,
  findAccountById,
  mayHoldASession,
  normalizeEmail,
  setEmail,
  setPasswordHash,
} from './users.ts'

export const RESET_PURPOSE = 'reset-password' as const
export const CHANGE_EMAIL_PURPOSE = 'change-email' as const
export const NEW_ADDRESS_SUFFIX = ':new'

export const EMAIL_SHAPE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/

export function pendingEmailKey(userId: string): string {
  return `email-change:${userId}`
}

function otp(deps: LoginDeps): OtpStore {
  return { redis: deps.redis, secret: deps.otpSecret }
}

function sessions(deps: LoginDeps): SessionStore {
  return { redis: deps.redis }
}

export type RecoveryStarted =
  | { outcome: 'code-sent'; account: Account; challenge: string; code: string }
  | { outcome: 'nothing-to-do' }
  | { outcome: 'slow-down'; retryAfterSeconds: number }

export async function startRecovery(
  deps: LoginDeps,
  input: { email: string; ip: string },
): Promise<RecoveryStarted> {
  const email = normalizeEmail(input.email)
  const allowed = await mayAttempt(deps.redis, 'password-reset', email, input.ip)
  if (!allowed.allowed) {
    return { outcome: 'slow-down', retryAfterSeconds: allowed.retryAfterSeconds }
  }

  const account = await findAccountByEmail(deps.run, email)
  if (account === undefined || !mayHoldASession(account)) {
    await recordFailure(deps.redis, 'password-reset', email, input.ip)
    return { outcome: 'nothing-to-do' }
  }

  const challenge = newChallenge()
  const issued = await issueCode(otp(deps), RESET_PURPOSE, account.id, challenge)
  if (issued.outcome !== 'issued') {
    return { outcome: 'nothing-to-do' }
  }

  return { outcome: 'code-sent', account, challenge, code: issued.code }
}

export type RecoveryFinished =
  | { outcome: 'password-changed'; account: Account; sessionsEnded: number }
  | { outcome: 'bad-password'; refusal: PasswordRefusal }
  | { outcome: 'wrong-code' }
  | { outcome: 'start-again' }

export async function finishRecovery(
  deps: LoginDeps,
  input: { userId: string; challenge: string; code: string; password: string },
): Promise<RecoveryFinished> {
  const verdict = await checkPassword(input.password, deps.pwned ?? {})
  if (!verdict.accepted) {
    return { outcome: 'bad-password', refusal: verdict.refusal }
  }

  const read = await verifyCode(otp(deps), RESET_PURPOSE, input.userId, input.challenge, input.code)
  if (read === 'wrong') {
    return { outcome: 'wrong-code' }
  }
  if (read !== 'accepted') {
    return { outcome: 'start-again' }
  }

  const account = await findAccountById(deps.run, input.userId)
  if (account === undefined || !mayHoldASession(account)) {
    return { outcome: 'start-again' }
  }

  await setPasswordHash(deps.run, account.id, await hashPassword(input.password))
  const sessionsEnded = await revokeEverySession(sessions(deps), account.id)
  await forgetFailures(deps.redis, 'password-reset', account.email)
  await forgetFailures(deps.redis, 'login', account.email)

  return { outcome: 'password-changed', account, sessionsEnded }
}

export type PasswordChanged =
  | { outcome: 'password-changed'; account: Account; sessionsEnded: number }
  | { outcome: 'bad-password'; refusal: PasswordRefusal }
  | { outcome: 'wrong-password' }

export async function changePassword(
  deps: LoginDeps,
  input: { userId: string; current: string; next: string },
): Promise<PasswordChanged> {
  const account = await findAccountById(deps.run, input.userId)
  if (account === undefined || !(await verifyPassword(account.passwordHash, input.current))) {
    return { outcome: 'wrong-password' }
  }

  const verdict = await checkPassword(input.next, deps.pwned ?? {})
  if (!verdict.accepted) {
    return { outcome: 'bad-password', refusal: verdict.refusal }
  }

  await setPasswordHash(deps.run, account.id, await hashPassword(input.next))
  const sessionsEnded = await revokeEverySession(sessions(deps), account.id)

  return { outcome: 'password-changed', account, sessionsEnded }
}

export type EmailChangeStarted =
  | {
      outcome: 'codes-sent'
      account: Account
      challenge: string
      currentCode: string
      newEmail: string
      newCode: string
    }
  | { outcome: 'wrong-password' }
  | { outcome: 'bad-address' }
  | { outcome: 'taken' }
  | { outcome: 'wait' }

export async function startEmailChange(
  deps: LoginDeps,
  input: { userId: string; password: string; email: string },
): Promise<EmailChangeStarted> {
  const account = await findAccountById(deps.run, input.userId)
  if (account === undefined || !(await verifyPassword(account.passwordHash, input.password))) {
    return { outcome: 'wrong-password' }
  }

  const email = normalizeEmail(input.email)
  if (!EMAIL_SHAPE.test(email) || email === account.email) {
    return { outcome: 'bad-address' }
  }
  if ((await findAccountByEmail(deps.run, email)) !== undefined) {
    return { outcome: 'taken' }
  }

  const challenge = newChallenge()
  const current = await issueCode(otp(deps), CHANGE_EMAIL_PURPOSE, account.id, challenge)
  if (current.outcome !== 'issued') {
    return { outcome: 'wait' }
  }

  const fresh = await issueCode(
    otp(deps),
    CHANGE_EMAIL_PURPOSE,
    `${account.id}${NEW_ADDRESS_SUFFIX}`,
    challenge,
  )
  if (fresh.outcome !== 'issued') {
    await forgetCode(otp(deps), CHANGE_EMAIL_PURPOSE, account.id)
    return { outcome: 'wait' }
  }

  await deps.redis.set(pendingEmailKey(account.id), `${challenge}:${email}`, {
    exSeconds: CODE_TTL_SECONDS,
  })

  return {
    outcome: 'codes-sent',
    account,
    challenge,
    currentCode: current.code,
    newEmail: email,
    newCode: fresh.code,
  }
}

export type EmailChanged =
  | { outcome: 'email-changed'; account: Account; email: string }
  | { outcome: 'wrong-code' }
  | { outcome: 'start-again' }
  | { outcome: 'taken' }

export async function finishEmailChange(
  deps: LoginDeps,
  input: { userId: string; challenge: string; currentCode: string; newCode: string },
): Promise<EmailChanged> {
  const pending = await deps.redis.get(pendingEmailKey(input.userId))
  const at = pending?.indexOf(':') ?? -1
  if (pending === null || pending === undefined || at === -1) {
    return { outcome: 'start-again' }
  }

  const [challenge, email] = [pending.slice(0, at), pending.slice(at + 1)]
  if (challenge !== input.challenge) {
    return { outcome: 'start-again' }
  }

  const here = await verifyCode(
    otp(deps),
    CHANGE_EMAIL_PURPOSE,
    input.userId,
    input.challenge,
    input.currentCode,
  )
  if (here === 'wrong') {
    return { outcome: 'wrong-code' }
  }
  if (here !== 'accepted') {
    return { outcome: 'start-again' }
  }

  const there = await verifyCode(
    otp(deps),
    CHANGE_EMAIL_PURPOSE,
    `${input.userId}${NEW_ADDRESS_SUFFIX}`,
    input.challenge,
    input.newCode,
  )
  if (there === 'wrong') {
    return { outcome: 'wrong-code' }
  }
  if (there !== 'accepted') {
    return { outcome: 'start-again' }
  }

  const account = await findAccountById(deps.run, input.userId)
  if (account === undefined) {
    return { outcome: 'start-again' }
  }

  const written = await setEmail(deps.run, input.userId, email)
  await deps.redis.del(pendingEmailKey(input.userId))

  return written === undefined
    ? { outcome: 'taken' }
    : { outcome: 'email-changed', account, email: written }
}
