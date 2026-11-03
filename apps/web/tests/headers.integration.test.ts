import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HSTS, PERMISSIONS_POLICY, REFERRER_POLICY } from '@internal/security-headers'
import { inlineAssets, scriptTags } from '@internal/security-headers/inline'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 3177
const ORIGIN = `http://localhost:${PORT}`
const built = existsSync(join(ROOT, '.next', 'BUILD_ID'))

if (!built) {
  if (process.env.WEB_HEADERS_TEST_REQUIRED === '1') {
    throw new Error(
      'WEB_HEADERS_TEST_REQUIRED is set but apps/web has no production build. ' +
        'These tests must not be skipped here: run `pnpm --filter @apps/web build` first.',
    )
  }
  process.stderr.write(
    '\nSkipping the security header tests: apps/web has no production build.\n' +
      'Run `pnpm --filter @apps/web build` first.\n\n',
  )
}

let server: ChildProcess | undefined

function nonceOf(response: Response): string | undefined {
  return /'nonce-([^']+)'/.exec(response.headers.get('content-security-policy') ?? '')?.[1]
}

async function answers(): Promise<boolean> {
  try {
    await fetch(ORIGIN, { signal: AbortSignal.timeout(1_000) })
    return true
  } catch {
    return false
  }
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await answers()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`next start never answered on ${ORIGIN}`)
}

beforeAll(async () => {
  if (!built) {
    return
  }
  const bin = join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next')
  server = spawn(process.execPath, [bin, 'start', '-p', `${PORT}`], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  server.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk))
  await waitForServer()
}, 60_000)

afterAll(() => {
  server?.kill()
})

describe.skipIf(!built)('the headers a real response carries', () => {
  it('sends every header the plan requires', async () => {
    const response = await fetch(ORIGIN)
    const headers = response.headers

    expect(headers.get('strict-transport-security')).toBe(HSTS)
    expect(headers.get('x-content-type-options')).toBe('nosniff')
    expect(headers.get('referrer-policy')).toBe(REFERRER_POLICY)
    expect(headers.get('permissions-policy')).toBe(PERMISSIONS_POLICY)
    expect(headers.get('x-frame-options')).toBe('DENY')
    expect(headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  })

  it('asks for the page to be preloaded into HSTS, as the plan says', async () => {
    const value = (await fetch(ORIGIN)).headers.get('strict-transport-security') ?? ''

    expect(value).toContain('includeSubDomains')
    expect(value).toContain('preload')
    expect(Number(/max-age=(\d+)/.exec(value)?.[1] ?? 0)).toBeGreaterThanOrEqual(31_536_000)
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
})
