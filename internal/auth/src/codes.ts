import { createHmac, randomBytes, randomInt } from 'node:crypto'

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 6
export const CODE_GROUP = 3

export const CHALLENGE_BYTES = 32

export type CodePurpose = 'login' | 'verify-email' | 'reset-password' | 'change-email'

export const CODE_PURPOSES: readonly CodePurpose[] = [
  'login',
  'verify-email',
  'reset-password',
  'change-email',
]

export function generateCode(length: number = CODE_LENGTH): string {
  let code = ''
  while (code.length < length) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  }
  return code
}

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function formatCode(code: string): string {
  const groups: string[] = []
  for (let at = 0; at < code.length; at += CODE_GROUP) {
    groups.push(code.slice(at, at + CODE_GROUP))
  }
  return groups.join('-')
}

export function newChallenge(): string {
  return randomBytes(CHALLENGE_BYTES).toString('base64url')
}

export function hashCode(secret: string, challenge: string, code: string): string {
  return createHmac('sha256', secret)
    .update(`${challenge}:${normalizeCode(code)}`)
    .digest('hex')
}
