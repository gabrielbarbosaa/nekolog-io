import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PERMISSIONS } from '@internal/auth'
import { describe, expect, it } from 'vitest'

const ORGS = fileURLToPath(new URL('../app/api/orgs/', import.meta.url))
const GUARD = readFileSync(fileURLToPath(new URL('../lib/guard.ts', import.meta.url)), 'utf8')

function routesUnder(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      found.push(...routesUnder(path))
    } else if (entry === 'route.ts') {
      found.push(path)
    }
  }
  return found
}

const ROUTES = routesUnder(ORGS).map((path) => ({
  name: path.slice(ORGS.length).replace(/\\/g, '/').replace('/route.ts', '') || '.',
  source: readFileSync(path, 'utf8'),
}))

const SCOPED = ROUTES.filter((route) => route.name.includes('[org]'))

describe('the gate every organization route goes through', () => {
  it('found the routes, so none of this is passing on an empty list', () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(8)
    expect(SCOPED.length).toBeGreaterThanOrEqual(7)
  })

  it.each(SCOPED)('$name asks the guard for a named permission', ({ source }) => {
    const asked = /guard\(request, org, '([^']+)'/.exec(source)?.[1]

    expect(asked, 'the route does not call guard(request, org, …)').toBeDefined()
    expect(PERMISSIONS as readonly string[]).toContain(asked)
  })

  it.each(SCOPED)(
    '$name takes the organization from the path, never from the body',
    ({ source }) => {
      expect(source).toContain('const { org } = await params')
      expect(source).not.toMatch(/stringField\(body, '(org|organization|organizationId)'\)/)
    },
  )

  it.each(SCOPED)('$name stops at the refusal instead of carrying on', ({ source }) => {
    expect(source).toMatch(/if \('refused' in gate\) \{\s*return gate\.refused\s*\}/)
  })

  it.each(ROUTES)('$name runs on Node and is never cached', ({ source }) => {
    expect(source).toContain("export const runtime = 'nodejs'")
    expect(source).toContain("export const dynamic = 'force-dynamic'")
  })
})

describe('what the guard itself has to do', () => {
  it('reads the role from the database for this person, not from the token', () => {
    expect(GUARD).toContain('roleIn(loginDeps().run, claims.sub, organizationId)')
    expect(GUARD).not.toMatch(/claims\.(role|org)/)
  })

  it('asks Redis whether the session is still alive before anything else', () => {
    expect(GUARD).toContain('liveSession(request)')
  })

  it('answers 404 for somebody who is not a member, so no organization is ever confirmed', () => {
    expect(GUARD).toMatch(/role === undefined[\s\S]{0,120}no_such_organization', 404/)
  })

  it('answers 403 only once membership is established', () => {
    const notAMember = GUARD.indexOf('no_such_organization')
    const notAllowed = GUARD.indexOf('not_allowed')

    expect(notAMember).toBeGreaterThan(-1)
    expect(notAllowed, 'the permission check must come after the membership check').toBeGreaterThan(
      notAMember,
    )
  })
})

describe('the two things that ask for the password again', () => {
  it.each(['[org]/transfer', '[org]/delete'])('%s does', (name) => {
    const route = SCOPED.find((candidate) => candidate.name === name)

    expect(route, `${name} is not a route`).toBeDefined()
    expect(route?.source).toContain('theyTypedTheirPassword(')
    expect(route?.source).toContain("refusal('invalid_credentials', 401)")
  })

  it('and nothing else asks, so the prompt keeps meaning something', () => {
    const asking = SCOPED.filter((route) => route.source.includes('theyTypedTheirPassword(')).map(
      (route) => route.name,
    )

    expect(asking.sort()).toEqual(['[org]/delete', '[org]/transfer'])
  })
})

describe('an action nobody can take on an owner', () => {
  it.each(['[org]/members/role', '[org]/members/remove'])('%s checks mayActOn first', (name) => {
    const route = SCOPED.find((candidate) => candidate.name === name)

    expect(route?.source).toContain('mayActOn(gate.allowed.role, target.role)')
  })

  it.each(['[org]/members/role', '[org]/members/invite'])('%s checks mayGrant first', (name) => {
    const route = SCOPED.find((candidate) => candidate.name === name)

    expect(route?.source).toContain('mayGrant(gate.allowed.role,')
  })
})
