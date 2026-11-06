import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const OPERATOR_API = join(ROOT, 'app', 'api', 'operator')
const OPERATOR_SCREEN = join(ROOT, 'app', 'operator')

const GATE = readFileSync(join(ROOT, 'lib', 'operator.ts'), 'utf8')

function filesUnder(directory: string, ending: string): Array<{ name: string; source: string }> {
  const found: Array<{ name: string; source: string }> = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      found.push(...filesUnder(path, ending))
    } else if (entry.endsWith(ending)) {
      found.push({
        name: path.slice(ROOT.length).replace(/\\/g, '/'),
        source: readFileSync(path, 'utf8'),
      })
    }
  }
  return found
}

const ROUTES = filesUnder(OPERATOR_API, 'route.ts')
const SCREEN = filesUnder(OPERATOR_SCREEN, '.tsx')

const WRITES = ROUTES.filter(
  (route) =>
    route.source.includes('export async function POST') && !route.name.includes('/unlock/'),
)

describe('who may reach the operator area', () => {
  it('found the routes, so none of this is passing on an empty list', () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(5)
    expect(WRITES.length).toBeGreaterThanOrEqual(3)
  })

  it.each(ROUTES)('$name goes through the operator gate', ({ source }) => {
    expect(source).toContain('await operatorGuard(request')
    expect(source).toMatch(/if \('refused' in gate\) \{\s*return gate\.refused\s*\}/)
  })

  it('reads the flag from the database for this person, not from the token', () => {
    expect(GATE).toContain('isOperator(loginDeps().run, claims.sub)')
    expect(GATE).not.toMatch(/claims\.(isOperator|operator|role)/)
  })

  it('answers 404 to somebody who is not an operator, so the area is never confirmed', () => {
    expect(GATE).toMatch(/isOperator[\s\S]{0,120}refusal\('not_found', 404\)/)
    expect(GATE, 'a 403 would admit the area exists').not.toMatch(
      /isOperator[\s\S]{0,120}refusal\('not_allowed'/,
    )
  })

  it('asks Redis whether the session is still alive before anything else', () => {
    expect(GATE).toContain('liveSession(request)')
  })
})

describe('the password this area asks for every time', () => {
  it.each(WRITES)('$name refuses while the area is locked', ({ source }) => {
    expect(source, 'a write must not pass needsUnlock: false').not.toMatch(
      /operatorGuard\(request, \{[^}]*needsUnlock: false/,
    )
  })

  it('is checked against the account, and only then opens the area', () => {
    const unlock = ROUTES.find((route) => route.name.endsWith('operator/unlock/route.ts'))

    expect(unlock?.source).toContain('theyTypedTheirPassword(gate.allowed.userId')
    expect(unlock?.source).toContain("refusal('invalid_credentials', 401)")
    expect(unlock?.source).toMatch(
      /theyTypedTheirPassword[\s\S]{0,200}await unlock\(gate\.allowed\.sessionId\)/,
    )
  })

  it('closes itself again, rather than staying open for the whole session', () => {
    expect(GATE).toContain('UNLOCK_SECONDS')
    expect(GATE).toMatch(/UNLOCK_SECONDS = 15 \* 60/)
    expect(GATE).toContain('exSeconds: UNLOCK_SECONDS')
  })

  it('is held per session, so another browser of the same person stays locked', () => {
    expect(GATE).toMatch(/operator:unlocked:\$\{sessionId\}/)
  })
})

describe('what this area is never allowed to see', () => {
  const EVERY_LINE_OF_IT = [...ROUTES, ...SCREEN]

  it.each(EVERY_LINE_OF_IT)('$name reads no log line', ({ source }) => {
    for (const forbidden of [
      'searchLogs',
      'contextAround',
      'logSearchQuery',
      'logContextQuery',
      'logHistogramQuery',
      'countVolume',
    ]) {
      expect(source, 'the operator sees usage, never what anybody logged').not.toContain(forbidden)
    }
  })

  it('counts through the usage rollup, which holds no message at all', () => {
    const usage = ROUTES.find((route) => route.name.endsWith('operator/usage/route.ts'))

    expect(usage?.source).toContain('clickHouseUsageStore')
    expect(usage?.source).toContain('eventsSince')
  })

  it('never hands back a password hash', () => {
    for (const { source } of ROUTES) {
      expect(source).not.toMatch(/passwordHash|password_hash/)
    }
  })
})

describe('suspending somebody', () => {
  it('ends the sessions they already hold, or suspension waits ten minutes', () => {
    const account = ROUTES.find((route) => route.name.includes('operator/accounts/[user]'))

    expect(account?.source).toContain('revokeEverySession')
    expect(account?.source).toMatch(/if \(suspended\) \{\s*await revokeEverySession/)
  })

  it('refuses to let an operator lock themselves out', () => {
    const account = ROUTES.find((route) => route.name.includes('operator/accounts/[user]'))

    expect(account?.source).toContain("refusal('not_yourself', 409)")
  })
})

describe('every operator route', () => {
  it.each(ROUTES)('$name runs on Node and is never cached', ({ source }) => {
    expect(source).toContain("export const runtime = 'nodejs'")
    expect(source).toContain("export const dynamic = 'force-dynamic'")
  })
})
