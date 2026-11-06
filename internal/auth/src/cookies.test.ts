import { describe, expect, it } from 'vitest'
import {
  ACCESS_COOKIE,
  CHALLENGE_COOKIE,
  cookieAttributes,
  openChallenge,
  originAllowed,
  REFRESH_COOKIE,
  sealChallenge,
} from './cookies.ts'

const SECRET = 'a-secret-for-the-cookies'

describe('the cookie names and attributes', () => {
  it('use the __Host- prefix, which pins them to one origin and to /', () => {
    for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, CHALLENGE_COOKIE]) {
      expect(name.startsWith('__Host-'), name).toBe(true)
    }
  })

  it('are the names section 11.3 writes down', () => {
    expect(ACCESS_COOKIE).toBe('__Host-at')
    expect(REFRESH_COOKIE).toBe('__Host-rt')
  })

  it('carry what the __Host- prefix requires, and nothing a script can read', () => {
    expect(cookieAttributes()).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    })
  })

  it('leave out maxAge when the cookie should die with the browser', () => {
    expect(cookieAttributes()).not.toHaveProperty('maxAge')
    expect(cookieAttributes(600)).toHaveProperty('maxAge', 600)
  })

  it('never carry a domain, which __Host- forbids', () => {
    expect(Object.keys(cookieAttributes(600))).not.toContain('domain')
  })
})

describe('the signed challenge cookie', () => {
  it('comes back as it went in', () => {
    const sealed = sealChallenge(SECRET, 'usr_1', 'abc')

    expect(openChallenge(SECRET, sealed)).toEqual({ userId: 'usr_1', challenge: 'abc' })
  })

  it('refuses a cookie whose user was changed', () => {
    const sealed = sealChallenge(SECRET, 'usr_1', 'abc')
    const forged = sealed.replace('usr_1', 'usr_2')

    expect(openChallenge(SECRET, forged)).toBeUndefined()
  })

  it('refuses a cookie whose challenge was changed', () => {
    const sealed = sealChallenge(SECRET, 'usr_1', 'abc')

    expect(openChallenge(SECRET, sealed.replace('.abc.', '.xyz.'))).toBeUndefined()
  })

  it('refuses one signed with another secret', () => {
    expect(openChallenge(SECRET, sealChallenge('another', 'usr_1', 'abc'))).toBeUndefined()
  })

  it('refuses nonsense without throwing', () => {
    for (const cookie of [undefined, '', '.', 'a.b', 'a.b.c.d', 'a..c', '..c']) {
      expect(openChallenge(SECRET, cookie), String(cookie)).toBeUndefined()
    }
  })
})

describe('the Origin a POST has to carry', () => {
  it('accepts the origin the dashboard is served from', () => {
    expect(originAllowed('https://app.nekolog.io', 'https://app.nekolog.io')).toBe(true)
    expect(originAllowed('https://app.nekolog.io', 'https://app.nekolog.io/login')).toBe(true)
  })

  it('refuses a different host, port or scheme', () => {
    expect(originAllowed('https://evil.test', 'https://app.nekolog.io')).toBe(false)
    expect(originAllowed('https://app.nekolog.io:8443', 'https://app.nekolog.io')).toBe(false)
    expect(originAllowed('http://app.nekolog.io', 'https://app.nekolog.io')).toBe(false)
  })

  it('refuses a host that merely starts the same', () => {
    expect(originAllowed('https://app.nekolog.io.evil.test', 'https://app.nekolog.io')).toBe(false)
  })

  it('refuses a request that sent no Origin at all', () => {
    expect(originAllowed(null, 'https://app.nekolog.io')).toBe(false)
    expect(originAllowed('', 'https://app.nekolog.io')).toBe(false)
  })

  it('refuses something that is not a URL', () => {
    expect(originAllowed('null', 'https://app.nekolog.io')).toBe(false)
    expect(originAllowed('not a url', 'https://app.nekolog.io')).toBe(false)
  })
})
