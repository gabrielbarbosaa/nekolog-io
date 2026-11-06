import type { ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { HSTS, PERMISSIONS_POLICY, REFERRER_POLICY } from '@internal/security-headers'
import { inlineAssets, scriptTags } from '@internal/security-headers/inline'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isBuilt, nonceOf, requireBuild, startNext } from './server.ts'

const PORT = 3179
const ORIGIN = `http://localhost:${PORT}`

requireBuild()

let server: ChildProcess | undefined

beforeAll(async () => {
  if (isBuilt) {
    server = await startNext(PORT)
  }
}, 60_000)

afterAll(() => {
  server?.kill()
})

describe.skipIf(!isBuilt)('the headers a real response carries', () => {
  it('sends every header the plan requires', async () => {
    const headers = (await fetch(ORIGIN)).headers

    expect(headers.get('strict-transport-security')).toBe(HSTS)
    expect(headers.get('x-content-type-options')).toBe('nosniff')
    expect(headers.get('referrer-policy')).toBe(REFERRER_POLICY)
    expect(headers.get('permissions-policy')).toBe(PERMISSIONS_POLICY)
    expect(headers.get('x-frame-options')).toBe('DENY')
    expect(headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  })

  it('never allows an inline script through unsafe-inline or eval', async () => {
    const csp = (await fetch(ORIGIN)).headers.get('content-security-policy') ?? ''
    const script = csp.split('; ').find((directive) => directive.startsWith('script-src ')) ?? ''

    expect(script).not.toContain("'unsafe-inline'")
    expect(script).not.toContain("'unsafe-eval'")
    expect(script).toMatch(/'nonce-[A-Za-z0-9+/=]+'/)
  })

  it('gives each response a nonce of its own', async () => {
    const [first, second] = await Promise.all([fetch(ORIGIN), fetch(ORIGIN)])

    expect(nonceOf(first)).toBeDefined()
    expect(nonceOf(first)).not.toBe(nonceOf(second))
  })

  it('reaches every script tag with that nonce, which strict-dynamic demands', async () => {
    const response = await fetch(ORIGIN)
    const nonce = nonceOf(response)
    const tags = scriptTags(await response.text())

    expect(tags.length).toBeGreaterThan(0)
    for (const tag of tags) {
      expect(tag.nonce, `this script would be blocked: ${tag.src ?? 'inline'}`).toBe(nonce)
    }
  })

  it('reaches every inline script and style with it too', async () => {
    const response = await fetch(ORIGIN)
    const nonce = nonceOf(response)
    const assets = inlineAssets(await response.text())

    expect(assets.length).toBeGreaterThan(0)
    for (const asset of assets) {
      expect(
        asset.nonce,
        `this ${asset.kind} would be blocked: ${asset.content.slice(0, 80)}`,
      ).toBe(nonce)
    }
  })

  it('writes no style attribute, which no nonce can reach', async () => {
    const html = await (await fetch(ORIGIN)).text()
    const attributes = [...html.matchAll(/style="[^"]{0,60}/g)].map((match) => match[0])

    expect(
      attributes,
      'style-src carries a nonce, and a nonce never applies to a style attribute: ' +
        'either move this into globals.css or widen the policy on purpose',
    ).toEqual([])
  })

  it('loads no script from anywhere but this origin', async () => {
    const html = await (await fetch(ORIGIN)).text()
    const sources = scriptTags(html)
      .map((tag) => tag.src)
      .filter((src): src is string => src !== null)

    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) {
      expect(source.startsWith('/'), `a script comes from outside: ${source}`).toBe(true)
    }
  })

  it('answers on /health, which is what the container is watched by', async () => {
    const response = await fetch(`${ORIGIN}/health`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'ok', app: 'nekolog/dashboard' })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('is given a signing key, because without one this answers 503 and not 200', () => {
    const server = readFileSync(fileURLToPath(new URL('./server.ts', import.meta.url)), 'utf8')

    expect(server).toContain("generateKeyPairSync('ed25519')")
    expect(server).toContain('AUTH_JWT_PRIVATE_KEY')
  })
})
