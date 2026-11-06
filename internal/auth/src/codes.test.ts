import { describe, expect, it } from 'vitest'
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  CODE_PURPOSES,
  formatCode,
  generateCode,
  hashCode,
  newChallenge,
  normalizeCode,
} from './codes.ts'

const SECRET = 'a-secret-for-the-codes'

describe('the alphabet the plan chose', () => {
  it('is the 31 characters it names, in that order', () => {
    expect(CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789')
    expect(CODE_ALPHABET).toHaveLength(31)
  })

  it('leaves out every pair someone would misread', () => {
    for (const confusable of ['0', 'O', '1', 'I', 'L']) {
      expect(CODE_ALPHABET.includes(confusable), confusable).toBe(false)
    }
  })

  it('reaches the number of combinations the plan claims', () => {
    expect(CODE_ALPHABET.length ** CODE_LENGTH).toBe(887_503_681)
  })

  it('names the four purposes the plan lists, and no fifth', () => {
    expect([...CODE_PURPOSES]).toEqual(['login', 'verify-email', 'reset-password', 'change-email'])
  })
})

describe('generating a code', () => {
  it('is six characters, all from the alphabet', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const code = generateCode()

      expect(code).toHaveLength(CODE_LENGTH)
      for (const character of code) {
        expect(CODE_ALPHABET.includes(character), `${code} has ${character}`).toBe(true)
      }
    }
  })

  it('reaches every character of the alphabet, so none is unreachable', () => {
    const seen = new Set<string>()
    for (let attempt = 0; attempt < 4_000; attempt += 1) {
      for (const character of generateCode()) {
        seen.add(character)
      }
    }

    expect([...seen].sort().join('')).toBe([...CODE_ALPHABET].sort().join(''))
  })

  it('does not repeat itself, which a broken source of randomness would', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateCode()))

    expect(codes.size).toBeGreaterThan(490)
  })
})

describe('reading what someone typed', () => {
  it('accepts lowercase, spaces and the hyphen it was shown with', () => {
    expect(normalizeCode('k7q-m2p')).toBe('K7QM2P')
    expect(normalizeCode(' K7Q M2P ')).toBe('K7QM2P')
    expect(normalizeCode('K7Q–M2P')).toBe('K7QM2P')
  })

  it('shows a code in two groups of three', () => {
    expect(formatCode('K7QM2P')).toBe('K7Q-M2P')
  })

  it('survives a round trip through what it shows', () => {
    const code = generateCode()

    expect(normalizeCode(formatCode(code))).toBe(code)
  })
})

describe('what Redis stores instead of the code', () => {
  it('is an HMAC, so the code itself is never written down', () => {
    const hash = hashCode(SECRET, 'challenge', 'K7QM2P')

    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain('K7QM2P')
  })

  it('binds the code to the browser that asked for it', () => {
    expect(hashCode(SECRET, 'one', 'K7QM2P')).not.toBe(hashCode(SECRET, 'two', 'K7QM2P'))
  })

  it('binds it to the secret, so another deployment cannot mint one', () => {
    expect(hashCode(SECRET, 'one', 'K7QM2P')).not.toBe(hashCode('other', 'one', 'K7QM2P'))
  })

  it('reads a typed code the same as the generated one', () => {
    expect(hashCode(SECRET, 'one', 'k7q-m2p')).toBe(hashCode(SECRET, 'one', 'K7QM2P'))
  })
})

describe('the challenge', () => {
  it('is long enough that nobody guesses it', () => {
    expect(Buffer.from(newChallenge(), 'base64url')).toHaveLength(32)
  })

  it('is different every time', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newChallenge()))

    expect(seen.size).toBe(200)
  })

  it('is safe in a cookie and in a URL', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      expect(newChallenge()).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })
})
