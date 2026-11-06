import { describe, expect, it } from 'vitest'
import {
  ARGON2_ITERATIONS,
  ARGON2_MEMORY_KIB,
  ARGON2_PARALLELISM,
  absentAccountDigest,
  digestNeedsRehash,
  hashPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  spendTheSameTime,
  verifyPassword,
} from './password.ts'

const PASSWORD = 'correct horse battery staple'

describe('the cost the plan writes down', () => {
  it('is the OWASP minimum for argon2id, and not less', () => {
    expect(ARGON2_MEMORY_KIB).toBe(19 * 1024)
    expect(ARGON2_ITERATIONS).toBe(2)
    expect(ARGON2_PARALLELISM).toBe(1)
  })

  it('is the cost the digest actually carries', async () => {
    const digest = await hashPassword(PASSWORD)

    expect(digest).toContain(
      `m=${ARGON2_MEMORY_KIB},t=${ARGON2_ITERATIONS},p=${ARGON2_PARALLELISM}`,
    )
  })

  it('bounds the password the way the plan says', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12)
    expect(MAX_PASSWORD_LENGTH).toBe(128)
  })
})

describe('hashing a password', () => {
  it('produces an argon2id digest, never the password', async () => {
    const digest = await hashPassword(PASSWORD)

    expect(digest.startsWith('$argon2id$')).toBe(true)
    expect(digest).not.toContain(PASSWORD)
  })

  it('salts, so the same password twice is two digests', async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD))
  })

  it('accepts the password it hashed and refuses every other', async () => {
    const digest = await hashPassword(PASSWORD)

    expect(await verifyPassword(digest, PASSWORD)).toBe(true)
    expect(await verifyPassword(digest, `${PASSWORD} `)).toBe(false)
    expect(await verifyPassword(digest, '')).toBe(false)
  })

  it('answers false for a digest it cannot read, rather than throwing', async () => {
    for (const broken of ['', 'not a digest', '$argon2id$v=19$m=1', '$2b$10$abcdefghijk']) {
      expect(await verifyPassword(broken, PASSWORD), broken).toBe(false)
    }
  })
})

describe('an address with no account behind it', () => {
  it('still costs a verification, so the answer takes the same time', async () => {
    expect(await spendTheSameTime(PASSWORD)).toBe(false)
  })

  it('hashes once and keeps it, because the cost is meant for the attempt', async () => {
    expect(await absentAccountDigest()).toBe(await absentAccountDigest())
  })

  it('is a real digest of the configured cost, not a placeholder string', async () => {
    const digest = await absentAccountDigest()

    expect(digest.startsWith('$argon2id$')).toBe(true)
    expect(digestNeedsRehash(digest)).toBe(false)
  })
})

describe('a digest from an older setting', () => {
  it('is marked for rehash when the cost no longer matches', () => {
    expect(digestNeedsRehash('$argon2id$v=19$m=4096,t=3,p=1$abc$def')).toBe(true)
  })

  it('is marked for rehash when it is not argon2id at all', () => {
    expect(digestNeedsRehash('$argon2i$v=19$m=19456,t=2,p=1$abc$def')).toBe(true)
    expect(digestNeedsRehash('$2b$12$abcdefghijklmnopqrstuv')).toBe(true)
  })

  it('leaves a current digest alone', async () => {
    expect(digestNeedsRehash(await hashPassword(PASSWORD))).toBe(false)
  })
})
