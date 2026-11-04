import { ISSUE_STATUSES } from '@nekolog-io/adapters'
import { HISTOGRAM_BUCKETS } from '@nekolog-io/clickhouse/search'
import { describe, expect, it } from 'vitest'
import { createApiApp } from './app.ts'
import { API_ERROR_CODES, STATUS_FOR_CODE } from './errors.ts'
import { OPENAPI_VERSION, openApiDocument } from './openapi.ts'

type Json = Record<string, unknown>

const DOCUMENT = openApiDocument([{ url: 'https://api.nekolog.io' }]) as unknown as Json

function dig(from: unknown, ...path: string[]): unknown {
  let current = from
  for (const step of path) {
    expect(current, `nothing at ${path.join('.')}`).toBeTypeOf('object')
    current = (current as Json)[step]
  }
  return current
}

const PATHS = Object.keys(dig(DOCUMENT, 'paths') as Json)

function routesOfTheApp(): string[] {
  const app = createApiApp({
    authenticate: () => ({ ok: true, principal: { projectId: 'p', environmentId: 'e' } }),
    database: 'nekolog_dev',
    query: async () => [],
  })
  return [
    ...new Set(
      app.routes
        .filter((route) => route.method === 'GET' && route.path !== '/*')
        .map((route) => route.path),
    ),
  ].sort()
}

function operations(): Array<[string, Json]> {
  return PATHS.map((path) => [path, dig(DOCUMENT, 'paths', path, 'get') as Json])
}

describe('the OpenAPI document, which is how this API is documented', () => {
  it('describes exactly the routes the app serves, in both directions', () => {
    expect(PATHS.slice().sort()).toEqual(routesOfTheApp())
  })

  it('is an OpenAPI 3.1 document with one server and no placeholder in it', () => {
    expect(DOCUMENT.openapi).toBe(OPENAPI_VERSION)
    expect(DOCUMENT.servers).toEqual([{ url: 'https://api.nekolog.io' }])
    expect(JSON.stringify(DOCUMENT)).not.toContain('${')
  })

  it('asks for a bearer key everywhere except the two routes that need none', () => {
    expect(DOCUMENT.security).toEqual([{ bearerAuth: [] }])

    for (const [path, operation] of operations()) {
      const open = path === '/health' || path === '/openapi.json'
      expect(operation.security, path).toEqual(open ? [] : undefined)
    }
  })

  it('gives every operation an id of its own', () => {
    const ids = operations().map(([, operation]) => operation.operationId)

    expect(ids.every((id) => typeof id === 'string' && id !== '')).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('documents every error code the app can answer with, and no other', () => {
    const enumerated = dig(
      DOCUMENT,
      'components',
      'schemas',
      'Error',
      'properties',
      'error',
      'properties',
      'code',
      'enum',
    ) as string[]

    expect(enumerated.slice().sort()).toEqual([...API_ERROR_CODES].sort())
    expect(DOCUMENT['x-nekolog-error-status']).toEqual(STATUS_FOR_CODE)
  })

  it('answers each documented status with a status the app really produces', () => {
    const produced = new Set(Object.values(STATUS_FOR_CODE).map(String))
    produced.add('200')

    for (const [path, operation] of operations()) {
      for (const status of Object.keys(operation.responses as Json)) {
        expect(produced, `${path} ${status}`).toContain(status)
      }
    }
  })

  it('offers only the buckets and the statuses the code accepts', () => {
    const serialised = JSON.stringify(DOCUMENT)

    expect(serialised).toContain(JSON.stringify([...HISTOGRAM_BUCKETS]))
    expect(serialised).toContain(JSON.stringify([...ISSUE_STATUSES]))
  })

  it('says that a key goes in a header, and never shows one', () => {
    expect(dig(DOCUMENT, 'components', 'securitySchemes', 'bearerAuth', 'type')).toBe('http')
    expect(dig(DOCUMENT, 'components', 'securitySchemes', 'bearerAuth', 'scheme')).toBe('bearer')
    expect(JSON.stringify(DOCUMENT)).not.toMatch(/nekolog_(pk|sk)_[A-Za-z0-9]{8}/)
  })

  it('survives a round trip through JSON, because that is how it is served', () => {
    expect(JSON.parse(JSON.stringify(DOCUMENT))).toEqual(DOCUMENT)
  })
})
