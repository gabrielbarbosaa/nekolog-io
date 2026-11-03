import { describe, expect, it } from 'vitest'
import { normaliseOrigin, originAllowed, originMatches } from './origins.ts'

describe('normaliseOrigin', () => {
  it.each([
    ['https://App.Example.COM', 'https://app.example.com'],
    ['https://app.example.com/', 'https://app.example.com'],
    ['  https://app.example.com  ', 'https://app.example.com'],
    ['HTTPS://app.example.com', 'https://app.example.com'],
    ['http://localhost:3000', 'http://localhost:3000'],
  ])('turns %s into %s', (input, expected) => {
    expect(normaliseOrigin(input)).toBe(expected)
  })

  it.each(['', '   ', 'app.example.com', 'https://', '://nope', 'null'])('refuses %s', (input) => {
    expect(normaliseOrigin(input)).toBeNull()
  })
})

describe('originMatches', () => {
  it('matches an exact origin, ignoring case and a trailing slash', () => {
    expect(originMatches('https://app.example.com', 'https://APP.example.com')).toBe(true)
    expect(originMatches('https://app.example.com/', 'https://app.example.com')).toBe(true)
  })

  it('treats the scheme as part of the origin', () => {
    expect(originMatches('https://app.example.com', 'http://app.example.com')).toBe(false)
  })

  it('treats the port as part of the origin', () => {
    expect(originMatches('http://localhost:3000', 'http://localhost:3001')).toBe(false)
    expect(originMatches('http://localhost:3000', 'http://localhost:3000')).toBe(true)
  })

  it('matches a subdomain wildcard', () => {
    expect(originMatches('https://*.example.com', 'https://app.example.com')).toBe(true)
    expect(originMatches('https://*.example.com', 'https://a.b.example.com')).toBe(true)
  })

  it.each([
    ['the bare domain', 'https://example.com'],
    ['a domain that merely ends the same way', 'https://aexample.com'],
    ['a domain that only looks like a subdomain', 'https://evilexample.com'],
    ['the pattern as a prefix of a longer domain', 'https://app.example.com.attacker.test'],
    ['a different scheme', 'http://app.example.com'],
  ])('does not let %s through a *.example.com wildcard', (_name, origin) => {
    expect(originMatches('https://*.example.com', origin)).toBe(false)
  })

  it('refuses a wildcard with nothing behind it', () => {
    expect(originMatches('https://*.', 'https://a.')).toBe(false)
  })

  it('takes a plain star as any origin', () => {
    expect(originMatches('*', 'https://anything.test')).toBe(true)
  })

  it('refuses garbage on either side', () => {
    expect(originMatches('https://app.example.com', 'not an origin')).toBe(false)
    expect(originMatches('not a pattern', 'https://app.example.com')).toBe(false)
  })
})

describe('originAllowed', () => {
  it('allows anything when there is no list', () => {
    expect(originAllowed(null, 'https://anywhere.test')).toBe(true)
    expect(originAllowed(null, null)).toBe(true)
  })

  it('allows nothing when the list is empty', () => {
    expect(originAllowed([], 'https://app.example.com')).toBe(false)
  })

  it('refuses a request with no Origin once a list exists', () => {
    expect(originAllowed(['https://app.example.com'], null)).toBe(false)
  })

  it('takes a match anywhere in the list', () => {
    const list = ['https://a.test', 'https://*.example.com', 'http://localhost:3000']

    expect(originAllowed(list, 'http://localhost:3000')).toBe(true)
    expect(originAllowed(list, 'https://b.example.com')).toBe(true)
    expect(originAllowed(list, 'https://c.test')).toBe(false)
  })
})
