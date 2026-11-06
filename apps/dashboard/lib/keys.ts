import 'server-only'
import {
  loadSigningKey,
  loadVerifyingKeys,
  type SigningKey,
  type VerifyingKey,
} from '@internal/auth'

function pem(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is not set, and no session can be signed or read without it.`)
  }
  return value.replace(/\\n/g, '\n')
}

let signing: Promise<SigningKey> | undefined
let verifying: Promise<VerifyingKey[]> | undefined

export function signingKey(): Promise<SigningKey> {
  signing ??= loadSigningKey(pem('AUTH_JWT_PRIVATE_KEY'))
  return signing
}

export function verifyingKeys(): Promise<ReadonlyArray<VerifyingKey>> {
  verifying ??= loadVerifyingKeys(
    [pem('AUTH_JWT_PUBLIC_KEY'), process.env.AUTH_JWT_PREVIOUS_PUBLIC_KEY ?? ''].join('\n'),
  )
  return verifying
}
