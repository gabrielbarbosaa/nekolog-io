import { type Algorithm, hash, verify } from '@node-rs/argon2'

const ARGON2ID = 2 as Algorithm

export const ARGON2_MEMORY_KIB = 19 * 1024
export const ARGON2_ITERATIONS = 2
export const ARGON2_PARALLELISM = 1

export const MIN_PASSWORD_LENGTH = 12
export const MAX_PASSWORD_LENGTH = 128

const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: ARGON2_MEMORY_KIB,
  timeCost: ARGON2_ITERATIONS,
  parallelism: ARGON2_PARALLELISM,
} as const

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS)
}

export async function verifyPassword(digest: string, password: string): Promise<boolean> {
  try {
    return await verify(digest, password, OPTIONS)
  } catch {
    return false
  }
}

let absent: Promise<string> | undefined

export async function absentAccountDigest(): Promise<string> {
  absent ??= hashPassword('there is no account behind this address')
  return absent
}

export async function spendTheSameTime(password: string): Promise<false> {
  await verifyPassword(await absentAccountDigest(), password)
  return false
}

export function digestNeedsRehash(digest: string): boolean {
  return (
    !digest.startsWith('$argon2id$') ||
    !digest.includes(`m=${ARGON2_MEMORY_KIB},t=${ARGON2_ITERATIONS},p=${ARGON2_PARALLELISM}`)
  )
}
