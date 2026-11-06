import type { RedisClient } from '@nekolog-io/adapters'
import { type CodePurpose, generateCode, hashCode, normalizeCode } from './codes.ts'
import { ISSUE_OTP, VERIFY_OTP } from './scripts.ts'

export const CODE_TTL_SECONDS = 600
export const MAX_ATTEMPTS = 5
export const RESEND_COOLDOWN_SECONDS = 60
export const MAX_SENDS_PER_HOUR = 5
export const SENDS_WINDOW_SECONDS = 3600

export type OtpStore = {
  redis: RedisClient
  secret: string
}

export type Issued =
  | { outcome: 'issued'; code: string }
  | { outcome: 'cooling-down' }
  | { outcome: 'too-many-sends' }

export type Verified = 'accepted' | 'expired' | 'wrong' | 'exhausted'

export function codeKey(purpose: CodePurpose, id: string): string {
  return `otp:${purpose}:${id}`
}

export function cooldownKey(purpose: CodePurpose, id: string): string {
  return `otp:cooldown:${purpose}:${id}`
}

export function sendsKey(purpose: CodePurpose, id: string): string {
  return `otp:sends:${purpose}:${id}`
}

export async function issueCode(
  store: OtpStore,
  purpose: CodePurpose,
  id: string,
  challenge: string,
): Promise<Issued> {
  const code = generateCode()
  const answer = await store.redis.eval(
    ISSUE_OTP,
    [codeKey(purpose, id), cooldownKey(purpose, id), sendsKey(purpose, id)],
    [
      challenge,
      hashCode(store.secret, challenge, code),
      String(CODE_TTL_SECONDS),
      String(RESEND_COOLDOWN_SECONDS),
      String(MAX_SENDS_PER_HOUR),
      String(SENDS_WINDOW_SECONDS),
    ],
  )

  if (Number(answer) === -1) {
    return { outcome: 'cooling-down' }
  }
  if (Number(answer) === -2) {
    return { outcome: 'too-many-sends' }
  }
  return { outcome: 'issued', code }
}

export async function verifyCode(
  store: OtpStore,
  purpose: CodePurpose,
  id: string,
  challenge: string,
  typed: string,
): Promise<Verified> {
  const answer = await store.redis.eval(
    VERIFY_OTP,
    [codeKey(purpose, id)],
    [challenge, hashCode(store.secret, challenge, normalizeCode(typed)), String(MAX_ATTEMPTS)],
  )

  switch (Number(answer)) {
    case 1:
      return 'accepted'
    case -2:
      return 'exhausted'
    case -1:
      return 'wrong'
    default:
      return 'expired'
  }
}

export async function forgetCode(store: OtpStore, purpose: CodePurpose, id: string): Promise<void> {
  await store.redis.del(codeKey(purpose, id))
}
