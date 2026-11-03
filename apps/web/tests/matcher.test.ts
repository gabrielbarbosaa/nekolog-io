import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isBuilt, ROOT, requireBuild } from './server.ts'

type FunctionsConfig = {
  functions: Record<string, { matchers: Array<{ regexp: string; originalSource: string }> }>
}

requireBuild()

function matchers(): RegExp[] {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, '.next', 'server', 'functions-config-manifest.json'), 'utf8'),
  ) as FunctionsConfig

  const entry = Object.entries(manifest.functions).find(([name]) => name.includes('middleware'))
  return (entry?.[1].matchers ?? []).map((matcher) => new RegExp(matcher.regexp))
}

function runsOn(path: string): boolean {
  return matchers().some((matcher) => matcher.test(path))
}

describe.skipIf(!isBuilt)('the paths the proxy was compiled to run on', () => {
  it('was compiled with a matcher at all', () => {
    expect(matchers()).not.toHaveLength(0)
  })

  it.each(['/', '/legal/terms', '/legal/privacy'])('runs on %s', (path) => {
    expect(runsOn(path)).toBe(true)
  })

  it.each(['/docs', '/docs/getting-started/introduction', '/docs/pt-br/'])(
    'stays out of %s, which the documentation serves with a policy of its own',
    (path) => {
      expect(
        runsOn(path),
        'the site would try to put its nonce policy on a page whose scripts are allowed by hash, ' +
          'and every one of them would be blocked',
      ).toBe(false)
    },
  )

  it.each(['/_next/static/chunks/a.js', '/_next/image'])('leaves %s alone', (path) => {
    expect(runsOn(path)).toBe(false)
  })
})
