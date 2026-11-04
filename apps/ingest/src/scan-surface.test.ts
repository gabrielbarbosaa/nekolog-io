import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { type Authenticator, createIngestApp, type IngestPrincipal } from './app.ts'

const SPEC = new URL('../../../docs/security/zap/ingest-openapi.json', import.meta.url)

const PRINCIPAL: IngestPrincipal = { projectId: 'prj_1', environmentId: 'env_1' }
const allow: Authenticator = () => ({ ok: true, principal: PRINCIPAL })

function surface(): string[] {
  const app = createIngestApp({ authenticate: allow, sink: () => undefined })
  return app.routes
    .filter((route) => route.method !== 'ALL')
    .map((route) => `${route.method} ${route.path}`)
    .sort()
}

async function described(): Promise<string[]> {
  const document = JSON.parse(await readFile(SPEC, 'utf8')) as {
    paths: Record<string, Record<string, unknown>>
  }
  return Object.entries(document.paths)
    .flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
    )
    .sort()
}

describe('the surface the scanner is pointed at', () => {
  it('is every route the ingestion answers, and nothing else', async () => {
    expect(await described()).toEqual(surface())
  })

  it('is not empty, so an empty file cannot pass as agreement', async () => {
    expect(surface().length).toBeGreaterThan(2)
  })

  it('describes the one place a key may ride in the URL, so the scanner probes it', async () => {
    const document = JSON.parse(await readFile(SPEC, 'utf8')) as Record<string, unknown>
    const post = (
      (document.paths as Record<string, Record<string, unknown>>)['/v1/logs'] as Record<
        string,
        unknown
      >
    ).post as { parameters: Array<{ name: string; in: string }> }

    expect(post.parameters.some((one) => one.name === 'key' && one.in === 'query')).toBe(true)
  })

  it('says plainly that it is not a published contract', async () => {
    const document = JSON.parse(await readFile(SPEC, 'utf8')) as {
      info: { summary: string }
    }

    expect(document.info.summary).toContain('Not a published contract')
  })
})
