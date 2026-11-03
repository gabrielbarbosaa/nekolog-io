import { existsSync } from 'node:fs'
import { HSTS, PERMISSIONS_POLICY, REFERRER_POLICY } from '@internal/security-headers'
import { describe, expect, it } from 'vitest'
import {
  CONFIG,
  configFor,
  DIST,
  headerValue,
  InlineStyleElement,
  inlineInDist,
  readConfig,
  serialise,
  UNSAFE_INLINE,
} from '../scripts/headers.ts'

const config = readConfig(CONFIG)
const csp = headerValue(config, 'content-security-policy') ?? ''
const built = existsSync(DIST)

if (!built) {
  if (process.env.DOCS_HEADERS_TEST_REQUIRED === '1') {
    throw new Error(
      'DOCS_HEADERS_TEST_REQUIRED is set but apps/docs has no dist/. ' +
        'These tests must not be skipped here: run `pnpm --filter @apps/docs build` first.',
    )
  }
  process.stderr.write(
    '\nSkipping the docs header tests against dist/: the site has not been built.\n' +
      'Run `pnpm --filter @apps/docs build` first.\n\n',
  )
}

function directive(name: string): string {
  return csp.split('; ').find((part) => part.startsWith(`${name} `)) ?? ''
}

describe('the policy the docs site is served with', () => {
  it('carries every header the plan requires', () => {
    expect(headerValue(config, 'strict-transport-security')).toBe(HSTS)
    expect(headerValue(config, 'x-content-type-options')).toBe('nosniff')
    expect(headerValue(config, 'referrer-policy')).toBe(REFERRER_POLICY)
    expect(headerValue(config, 'permissions-policy')).toBe(PERMISSIONS_POLICY)
    expect(csp).toContain("frame-ancestors 'none'")
  })

  it('applies them to every path, not only the home page', () => {
    const rules = (config as { headers: Array<{ source: string }> }).headers

    expect(rules).toHaveLength(1)
    expect(rules[0]?.source).toBe('/(.*)')
  })

  it('never allows a script through unsafe-inline or eval', () => {
    expect(directive('script-src')).not.toContain(UNSAFE_INLINE)
    expect(directive('script-src')).not.toContain("'unsafe-eval'")
  })

  it('allows inline style, and that is the only concession', () => {
    expect(directive('style-src')).toContain(UNSAFE_INLINE)
    expect(csp.split(UNSAFE_INLINE).length - 1).toBe(1)
  })

  it('locks the script sources to this origin and a list of hashes', () => {
    const sources = directive('script-src').split(' ').slice(1)

    expect(sources[0]).toBe("'self'")
    expect(sources.length).toBeGreaterThan(1)
    for (const source of sources.slice(1)) {
      expect(source).toMatch(/^'sha256-[A-Za-z0-9+/=]+'$/)
    }
  })
})

describe.skipIf(!built)('against the site the build just produced', () => {
  it('covers every inline script with a hash that is really in the policy', async () => {
    const inline = await inlineInDist(DIST)
    const scripts = inline.filter((asset) => asset.kind === 'script')

    expect(scripts.length).toBeGreaterThan(0)
    for (const script of scripts) {
      expect(csp, `no hash covers this inline script: ${script.sample}`).toContain(
        `'sha256-${script.digest}'`,
      )
    }
  })

  it('is exactly what the generator would write today', async () => {
    expect(serialise(configFor(await inlineInDist(DIST)))).toBe(serialise(config))
  })

  it('refuses to write a policy where a style hash would silence unsafe-inline', async () => {
    const inline = await inlineInDist(DIST)

    expect(() =>
      configFor([...inline, { kind: 'style', digest: 'x', sample: 'p{color:red}' }]),
    ).toThrow(InlineStyleElement)
  })
})
