import { ACCESS_COOKIE, REFRESH_COOKIE } from '@internal/auth'
import { describe, expect, it } from 'vitest'
import { clearCookie, cookieFrom, withCookies } from '../lib/cookies.ts'

describe('reading one cookie out of the header', () => {
  it('finds it wherever it sits, and keeps a value holding an equals sign whole', () => {
    const header = `theme=dark; ${ACCESS_COOKIE}=a.b.c==; ${REFRESH_COOKIE}=sid.secret`

    expect(cookieFrom(header, ACCESS_COOKIE)).toBe('a.b.c==')
    expect(cookieFrom(header, REFRESH_COOKIE)).toBe('sid.secret')
  })

  it('never answers with a cookie whose name merely ends the same way', () => {
    expect(cookieFrom(`not-${ACCESS_COOKIE}=theirs`, ACCESS_COOKIE)).toBeUndefined()
  })

  it('reads nothing out of nothing, and nothing out of an empty value', () => {
    expect(cookieFrom(null, ACCESS_COOKIE)).toBeUndefined()
    expect(cookieFrom('', ACCESS_COOKIE)).toBeUndefined()
    expect(cookieFrom(`${ACCESS_COOKIE}=`, ACCESS_COOKIE)).toBeUndefined()
  })
})

describe('rewriting the header the request carries on with', () => {
  it('replaces what it writes and leaves every other cookie in place', () => {
    const rewritten = withCookies(`theme=dark; ${ACCESS_COOKIE}=old; locale=pt-BR`, {
      [ACCESS_COOKIE]: 'new',
    })

    expect(cookieFrom(rewritten, ACCESS_COOKIE)).toBe('new')
    expect(cookieFrom(rewritten, 'theme')).toBe('dark')
    expect(cookieFrom(rewritten, 'locale')).toBe('pt-BR')
    expect(rewritten).not.toContain('old')
  })

  it('takes a cookie out when what it writes is empty, so a dead token never travels on', () => {
    const rewritten = withCookies(`theme=dark; ${ACCESS_COOKIE}=dead`, { [ACCESS_COOKIE]: '' })

    expect(rewritten).toBe('theme=dark')
  })

  it('adds a cookie the request did not carry', () => {
    expect(withCookies(null, { [ACCESS_COOKIE]: 'fresh' })).toBe(`${ACCESS_COOKIE}=fresh`)
  })
})

describe('clearing a __Host- cookie', () => {
  it('writes the attributes the prefix demands, because a bare delete is ignored', () => {
    const written: Array<[string, string, Record<string, unknown>]> = []
    clearCookie(
      { cookies: { set: (name, value, options) => written.push([name, value, { ...options }]) } },
      ACCESS_COOKIE,
    )

    expect(written).toEqual([
      [ACCESS_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 }],
    ])
  })
})
