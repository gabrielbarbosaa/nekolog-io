import { randomBytes } from 'node:crypto'
import { newChallenge } from './codes.ts'
import { findOpenInvite } from './invites.ts'
import type { LoginDeps } from './login.ts'
import { issueCode } from './otp.ts'
import { hashPassword } from './password.ts'
import { checkPassword, type PasswordRefusal } from './policy.ts'
import { findAccountByEmail } from './users.ts'

export const USER_ID_PREFIX = 'usr_'
export const MEMBERSHIP_ID_PREFIX = 'mem_'
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ID_LENGTH = 26

export const MIN_NAME_LENGTH = 1
export const MAX_NAME_LENGTH = 80

export function newId(prefix: string): string {
  const body = Array.from(randomBytes(ID_LENGTH), (byte) => CROCKFORD[byte % 32]).join('')
  return `${prefix}${body}`
}

export function readName(input: string): string | undefined {
  const name = input.trim().replace(/\s+/g, ' ')
  return name.length >= MIN_NAME_LENGTH && name.length <= MAX_NAME_LENGTH ? name : undefined
}

export type SignUpInput = {
  token: string
  name: string
  password: string
  locale: string
}

export type SignedUp =
  | { outcome: 'code-sent'; userId: string; challenge: string; code: string; email: string }
  | { outcome: 'no-invite' }
  | { outcome: 'bad-name' }
  | { outcome: 'bad-password'; refusal: PasswordRefusal }
  | { outcome: 'account-exists' }
  | { outcome: 'wait' }

const CREATE_USER = `
  insert into users (id, name, email, password_hash, locale)
  values ($1, $2, $3, $4, $5)
  on conflict (email) do nothing
  returning id
`

export async function signUp(deps: LoginDeps, input: SignUpInput): Promise<SignedUp> {
  const invite = await findOpenInvite(deps.run, input.token)
  if (invite === undefined) {
    return { outcome: 'no-invite' }
  }

  const name = readName(input.name)
  if (name === undefined) {
    return { outcome: 'bad-name' }
  }

  const verdict = await checkPassword(input.password, deps.pwned ?? {})
  if (!verdict.accepted) {
    return { outcome: 'bad-password', refusal: verdict.refusal }
  }

  const existing = await findAccountByEmail(deps.run, invite.email)
  if (existing !== undefined && existing.emailVerifiedAt !== undefined) {
    return { outcome: 'account-exists' }
  }

  let userId = existing?.id
  if (userId === undefined) {
    const rows = await deps.run(CREATE_USER, [
      newId(USER_ID_PREFIX),
      name,
      invite.email,
      await hashPassword(input.password),
      input.locale,
    ])
    const created = rows[0]
    if (created === undefined) {
      return { outcome: 'account-exists' }
    }
    userId = String(created.id)
  }

  const challenge = newChallenge()
  const issued = await issueCode(
    { redis: deps.redis, secret: deps.otpSecret },
    'verify-email',
    userId,
    challenge,
  )

  if (issued.outcome !== 'issued') {
    return { outcome: 'wait' }
  }

  return { outcome: 'code-sent', userId, challenge, code: issued.code, email: invite.email }
}
