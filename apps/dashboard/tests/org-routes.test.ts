import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { needsThePasswordAgain, PERMISSIONS, type Permission } from '@internal/auth'
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

function permissionsAsked(source: string): Permission[] {
  return [...source.matchAll(/guard\(request, org, '([^']+)'/g)].map(
    (match) => match[1] as Permission,
  )
}

describe('the gate every organization route goes through', () => {
  it('found the routes, so none of this is passing on an empty list', () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(14)
    expect(SCOPED.length).toBeGreaterThanOrEqual(13)
  })

  it.each(SCOPED)('$name asks the guard for a named permission', ({ source }) => {
    const asked = permissionsAsked(source)

    expect(asked, 'the route does not call guard(request, org, …)').not.toEqual([])
    for (const permission of asked) {
      expect(PERMISSIONS as readonly string[]).toContain(permission)
    }
  })

  it.each(SCOPED)(
    '$name takes the organization from the path, never from the body',
    ({ source }) => {
      expect(source).toMatch(/const \{ org(?:, [a-z]+)* \} = await params/)
      expect(source).not.toMatch(
        /stringField\(body, '(org|organization|organizationId|project|projectId|env|environment|environmentId)'\)/,
      )
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

describe('the routes that ask for the password again', () => {
  const ASKS = SCOPED.filter((route) => route.source.includes('theyTypedTheirPassword('))

  it('found some, so none of this is passing on an empty list', () => {
    expect(ASKS.length).toBeGreaterThanOrEqual(3)
  })

  it.each(ASKS)('$name refuses a wrong password rather than carrying on', ({ source }) => {
    expect(source).toContain("refusal('invalid_credentials', 401)")
  })

  it('asks exactly where the matrix says a password is asked again', () => {
    const shouldAsk = SCOPED.filter((route) =>
      permissionsAsked(route.source).some(needsThePasswordAgain),
    ).map((route) => route.name)
    const doesAsk = ASKS.map((route) => route.name)

    expect(
      doesAsk.sort(),
      'the list is derived from needsThePasswordAgain, not written down',
    ).toEqual(shouldAsk.sort())
  })

  it('and the permissions that demand it are the two the matrix names', () => {
    expect(PERMISSIONS.filter(needsThePasswordAgain)).toEqual([
      'projects:delete',
      'organization:delete',
    ])
  })
})

describe('an API key, which is a credential this screen hands out', () => {
  const KEYS = SCOPED.filter((route) => route.name.includes('/keys'))

  it('found the key routes, so none of this is passing on an empty list', () => {
    expect(KEYS.map((route) => route.name).sort()).toEqual([
      '[org]/projects/[project]/environments/[env]/keys',
      '[org]/projects/[project]/keys',
      '[org]/projects/[project]/keys/[key]/revoke',
      '[org]/projects/[project]/keys/[key]/rotate',
    ])
  })

  it.each(KEYS)(
    '$name asks for keys:write, which the matrix gives an administrator',
    ({ source }) => {
      expect(permissionsAsked(source)).toEqual(['keys:write'])
    },
  )

  it.each(KEYS)('$name never logs the key it handled', ({ source }) => {
    for (const line of [...source.matchAll(/console\.(?:log|error|warn)\(([^\n]*)/g)]) {
      expect(line[1]).not.toMatch(/\bvalue\b/)
    }
  })

  it('writes the hint into the audit log and never the key', () => {
    for (const route of KEYS) {
      expect(route.source).not.toMatch(/metadata:[^}]*\bvalue\b/)
    }
  })

  it('hands the key back on exactly the two answers that mint one', () => {
    const handing = KEYS.filter((route) => route.source.includes('value: minted.value')).map(
      (route) => route.name,
    )
    const rotating = KEYS.filter((route) => route.source.includes('value: rotated.value')).map(
      (route) => route.name,
    )

    expect([...handing, ...rotating].sort()).toEqual([
      '[org]/projects/[project]/environments/[env]/keys',
      '[org]/projects/[project]/keys/[key]/rotate',
    ])
  })

  it('never puts a key in the list a screen reads', () => {
    const list = KEYS.find((route) => route.name === '[org]/projects/[project]/keys')

    expect(list?.source).toContain('listKeys(run, org, project)')
    expect(list?.source).not.toContain('value')
  })

  it('says a key is not revoked rather than leaving the field out', () => {
    const list = KEYS.find((route) => route.name === '[org]/projects/[project]/keys')

    expect(list?.source, 'an absent revokedAt reads as "live" by accident').toContain(
      'revokedAt: key.revokedAt ?? null',
    )
    expect(list?.source).toContain('lastUsedAt: key.lastUsedAt ?? null')
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
