import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const API = join(ROOT, 'app', 'api')

const GATE = readFileSync(join(ROOT, 'lib', 'demo.ts'), 'utf8')
const GUARD = readFileSync(join(ROOT, 'lib', 'guard.ts'), 'utf8')

type Route = { name: string; source: string }

function routesUnder(directory: string): Route[] {
  const found: Route[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      found.push(...routesUnder(path))
    } else if (entry === 'route.ts') {
      found.push({
        name: path
          .slice(API.length + 1)
          .replace(/\\/g, '/')
          .replace('/route.ts', ''),
        source: readFileSync(path, 'utf8'),
      })
    }
  }
  return found
}

const ROUTES = routesUnder(API)

const SIGNED_OUT = [
  'auth/login/start',
  'auth/login/verify',
  'auth/login/resend',
  'auth/logout',
  'auth/refresh',
  'auth/signup',
  'auth/verify-email',
  'auth/password/forgot',
  'auth/password/reset',
  'demo',
  'health',
]

function reaches(route: Route): 'anonymous' | 'guard' | 'operator' | 'demo-gate' | 'open' {
  if (SIGNED_OUT.includes(route.name)) {
    return 'anonymous'
  }
  if (route.source.includes('await guard(request,')) {
    return 'guard'
  }
  if (route.source.includes('await operatorGuard(request')) {
    return 'operator'
  }
  if (route.source.includes('await notTheDemo(request)')) {
    return 'demo-gate'
  }
  return 'open'
}

describe('what a demo session is allowed to reach', () => {
  it('found the routes, so none of this is passing on an empty list', () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(25)
  })

  it.each(ROUTES)('$name is classified, rather than left to chance', (route) => {
    const where = reaches(route)

    if (where !== 'open') {
      expect(where).toBeDefined()
      return
    }

    expect(
      route.source.includes('export async function POST') ||
        route.source.includes('export async function DELETE'),
      `${route.name} writes and passes through no gate that knows about the demo`,
    ).toBe(false)
  })

  it('the only routes that answer a stranger are the ones that have to', () => {
    const anonymous = ROUTES.filter((route) => reaches(route) === 'anonymous').map(
      (route) => route.name,
    )

    expect(anonymous.sort(), 'adding one here is adding an unauthenticated endpoint').toEqual(
      [...SIGNED_OUT].filter((name) => ROUTES.some((route) => route.name === name)).sort(),
    )
  })
})

describe('the two gates that know about the demo', () => {
  it('the organization gate refuses a write even when the role would allow it', () => {
    expect(GUARD).toContain('actor.justLooking')
    expect(GUARD).toContain('refusal(DEMO_IS_READ_ONLY, 403)')
  })

  it('and it reads that from the database, in the same statement as the role', () => {
    expect(GUARD).toContain('actorIn(loginDeps().run, claims.sub, organizationId)')
  })

  it('the account gate refuses the demo outright, read or write', () => {
    expect(GATE).toContain('justLooking(loginDeps().run, claims.sub)')
    expect(GATE).toContain('refusal(DEMO_IS_READ_ONLY, 403)')
    expect(GATE, 'the sessions of a shared account are other visitors').not.toContain('writes')
  })
})

describe('the route that opens a demo session', () => {
  const route = ROUTES.find((one) => one.name === 'demo')

  it('exists, and checks the origin like every other write', () => {
    expect(route?.source).toContain("originAllowed(request.headers.get('origin')")
  })

  it('holds the same visitor back rather than minting sessions forever', () => {
    expect(route?.source).toContain('mayOpenADemo(deps.redis, ip)')
    expect(route?.source).toContain('too_many_attempts')
    expect(route?.source).toContain('retry-after')
  })

  it('signs in whoever the database says is the demo, never an id from the request', () => {
    expect(route?.source).toContain('findDemoAccount(deps.run)')
    expect(route?.source).toContain('userId: demo.userId')
    expect(route?.source, 'a user id off the request would be an open door').not.toMatch(
      /stringField\(body, '(user|userId|account)'\)/,
    )
  })

  it('never asks anyone to be remembered, so a shared machine forgets the demo', () => {
    expect(route?.source).toContain('remember: false')
    expect(route?.source).toMatch(/cookieAttributes\(undefined\)/)
  })

  it('says so rather than throwing when no demo is set up', () => {
    expect(route?.source).toContain("refusal('demo_unavailable', 503)")
  })
})
