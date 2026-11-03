import { describe, expect, it } from 'vitest'
import {
  contentSecurityPolicy,
  HSTS,
  hashSource,
  InvalidSource,
  newNonce,
  nonceSource,
  PERMISSIONS_POLICY,
  securityHeaders,
} from './policy.ts'

function directive(policy: string, name: string): string {
  return policy.split('; ').find((part) => part.startsWith(`${name} `)) ?? ''
}

describe('contentSecurityPolicy', () => {
  it('refuses to be framed, which is the clickjacking answer the plan asks for', () => {
    expect(contentSecurityPolicy()).toContain("frame-ancestors 'none'")
  })

  it('closes the directives an attacker reaches for when script-src holds', () => {
    const policy = contentSecurityPolicy()

    expect(directive(policy, 'base-uri')).toBe("base-uri 'none'")
    expect(directive(policy, 'object-src')).toBe("object-src 'none'")
    expect(directive(policy, 'form-action')).toBe("form-action 'self'")
  })

  it('never allows inline script or eval, whatever it is given', () => {
    const policy = contentSecurityPolicy({
      scriptSources: [nonceSource('abc'), hashSource('def')],
      strictDynamic: true,
    })

    expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'")
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-eval'")
  })

  it('only says strict-dynamic when asked, because a static site cannot use it', () => {
    expect(contentSecurityPolicy()).not.toContain("'strict-dynamic'")
    expect(contentSecurityPolicy({ strictDynamic: true })).toContain("'strict-dynamic'")
  })

  it('upgrades anything still asked for over http', () => {
    expect(contentSecurityPolicy()).toContain('upgrade-insecure-requests')
  })

  it('names a default so a directive nobody listed is not wide open', () => {
    expect(contentSecurityPolicy()).toContain("default-src 'self'")
  })
})

describe('a source that would escape its directive', () => {
  it.each([
    ["'self'; script-src *", 'a second directive'],
    ["'self' *", 'a second source'],
    ['https://a.test\nX-Other: 1', 'a header of its own'],
    ['', 'nothing at all'],
  ])('refuses %j, which would smuggle %s', (source) => {
    expect(() => contentSecurityPolicy({ scriptSources: [source] })).toThrow(InvalidSource)
  })

  it('checks the sources of every directive, not only the first', () => {
    expect(() => contentSecurityPolicy({ connectSources: ['https://a.test *'] })).toThrow(
      InvalidSource,
    )
    expect(() => contentSecurityPolicy({ styleSources: ['https://a.test *'] })).toThrow(
      InvalidSource,
    )
  })

  it('still accepts the shapes a real source has', () => {
    expect(() =>
      contentSecurityPolicy({
        scriptSources: [nonceSource('Nn49D6TPRZrUlgMKowxyyA=='), hashSource('f/zAUE74+ucc3=')],
        connectSources: ['https://ingest-prod.nekolog.io', 'data:'],
      }),
    ).not.toThrow()
  })
})

describe('securityHeaders', () => {
  it('asks for two years of HSTS, with subdomains and preload', () => {
    expect(securityHeaders()['Strict-Transport-Security']).toBe(HSTS)
    expect(HSTS).toContain('includeSubDomains')
    expect(HSTS).toContain('preload')
    expect(Number(/max-age=(\d+)/.exec(HSTS)?.[1] ?? 0)).toBeGreaterThanOrEqual(31_536_000)
  })

  it('turns off the device permissions a logging site never needs', () => {
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) {
      expect(PERMISSIONS_POLICY).toContain(`${feature}=()`)
    }
  })

  it('still sends the old frame header for whoever does not read CSP', () => {
    expect(securityHeaders()['X-Frame-Options']).toBe('DENY')
  })

  it('does not leak the path of a page to another origin', () => {
    expect(securityHeaders()['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
  })

  it('refuses to sniff a type the server did not declare', () => {
    expect(securityHeaders()['X-Content-Type-Options']).toBe('nosniff')
  })
})

describe('newNonce', () => {
  it('gives a different value every time', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newNonce()))

    expect(seen.size).toBe(200)
  })

  it('carries at least sixteen bytes, which is what makes guessing hopeless', () => {
    expect(atob(newNonce())).toHaveLength(16)
  })

  it('produces a value a policy accepts as a source', () => {
    expect(() =>
      contentSecurityPolicy({
        scriptSources: Array.from({ length: 50 }, () => nonceSource(newNonce())),
      }),
    ).not.toThrow()
  })
})
