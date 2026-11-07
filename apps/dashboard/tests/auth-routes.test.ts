import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const API = fileURLToPath(new URL('../app/api/', import.meta.url))

const TURNSTILE_GUARDS = ['login/start', 'signup', 'password/forgot']

const NEEDS_A_LIVE_SESSION = [
  'auth/password/change',
  'auth/email/change',
  'auth/email/confirm',
  'auth/sessions',
  'auth/logout-all',
]

const ENDS_EVERY_SESSION = ['auth/password/change', 'auth/password/reset', 'auth/logout-all']

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

const ROUTES = routesUnder(API).map((path) => ({
  name: path.slice(API.length).replace(/\\/g, '/').replace('/route.ts', ''),
  source: readFileSync(path, 'utf8'),
}))

const POSTS = ROUTES.filter((route) => route.source.includes('export async function POST'))

describe('the auth routes that accept a POST', () => {
  it('were found, so none of this is passing on an empty list', () => {
    expect(POSTS.length).toBeGreaterThanOrEqual(3)
    expect(POSTS.map((route) => route.name).sort()).toContain('auth/login/start')
  })

  it('has exactly one indirection for the origin check, and it does check', () => {
    const guard = readFileSync(fileURLToPath(new URL('../lib/guard.ts', import.meta.url)), 'utf8')

    expect(guard).toContain("originAllowed(request.headers.get('origin')")
    expect(guard).toContain("refusal('bad_origin', 403)")
  })

  it('and the operator gate checks it too, because it answers to nobody else', () => {
    const operator = readFileSync(
      fileURLToPath(new URL('../lib/operator.ts', import.meta.url)),
      'utf8',
    )

    expect(operator).toContain("originAllowed(request.headers.get('origin')")
    expect(operator).toContain("refusal('bad_origin', 403)")
  })

  it.each(POSTS)('$name refuses a request from another origin', ({ source }) => {
    const inline =
      source.includes("originAllowed(request.headers.get('origin')") &&
      source.includes('status: 403')

    expect(
      inline ||
        source.includes('await guard(request,') ||
        source.includes('await operatorGuard(request'),
      'a POST either checks the origin itself or goes through one of the two gates',
    ).toBe(true)
  })

  it.each(POSTS)('$name runs on Node, where the crypto and the driver live', ({ source }) => {
    expect(source).toContain("export const runtime = 'nodejs'")
  })

  it.each(POSTS)(
    '$name is never cached, because it reads cookies and writes them',
    ({ source }) => {
      expect(source).toContain("export const dynamic = 'force-dynamic'")
    },
  )
})

describe('Turnstile, which is off until a key exists', () => {
  it.each(TURNSTILE_GUARDS)('%s checks it, so setting the key is all it takes', (name) => {
    const route = POSTS.find((candidate) => candidate.name === `auth/${name}`)

    expect(route, `auth/${name} is not a POST route`).toBeDefined()
    expect(route?.source).toContain('checkTurnstile(')
    expect(route?.source).toContain("=== 'refused'")
  })

  it.each(TURNSTILE_GUARDS)(
    '%s refuses when the check refuses, rather than carrying on',
    (name) => {
      const route = POSTS.find((candidate) => candidate.name === `auth/${name}`)

      expect(route?.source).toMatch(/human === 'refused'[\s\S]{0,120}status: 403/)
    },
  )
})

describe('an action that is only for the person who is signed in', () => {
  it.each(NEEDS_A_LIVE_SESSION)(
    '%s asks Redis whether the session still exists, rather than trusting the token',
    (name) => {
      const route = ROUTES.find((candidate) => candidate.name === name)

      expect(route, `${name} is not a route`).toBeDefined()
      expect(route?.source).toContain('liveSession(request)')
      expect(route?.source).toContain('status: 401')
    },
  )

  it.each(ENDS_EVERY_SESSION)('%s clears the cookies it just made worthless', (name) => {
    const route = ROUTES.find((candidate) => candidate.name === name)

    expect(route?.source).toContain('clearCookie(response, ACCESS_COOKIE)')
    expect(route?.source).toContain('clearCookie(response, REFRESH_COOKIE)')
  })

  it('never reads the account id out of the body, only out of the verified token', () => {
    for (const route of ROUTES.filter((candidate) =>
      NEEDS_A_LIVE_SESSION.includes(candidate.name),
    )) {
      expect(route.source, route.name).not.toMatch(/stringField\(body, '(userId|sub|email_of)'\)/)
      expect(route.source, route.name).toContain('claims.sub')
    }
  })
})

describe('what the routes must never write down', () => {
  function logsIn(source: string): string[] {
    return [...source.matchAll(/console\.(?:log|error|warn)\(([^\n]*)/g)]
      .map((match) => match[1] as string)
      .map((line) => line.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''"))
  }

  it('found some logging across the routes, so this is not vacuous', () => {
    expect(POSTS.flatMap((route) => logsIn(route.source)).length).toBeGreaterThan(0)
  })

  it.each(POSTS)('$name logs no identifier that holds a secret', ({ source }) => {
    for (const line of logsIn(source)) {
      for (const secret of ['password', 'code', 'token', 'refreshToken', 'challenge', 'notice']) {
        expect(line, `${line} carries ${secret}`).not.toMatch(new RegExp(`\\b${secret}\\b`, 'i'))
      }
    }
  })

  it.each(POSTS)('$name answers the same way for an unknown account', ({ name, source }) => {
    if (name !== 'auth/login/start') {
      return
    }
    expect(source).toContain("error: 'invalid_credentials'")
    expect(source).not.toContain('no such user')
    expect(source).not.toContain('unknown_email')
  })
})
