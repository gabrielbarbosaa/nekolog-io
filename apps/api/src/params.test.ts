import { describe, expect, it } from 'vitest'
import { HISTOGRAM_PARAMS, ISSUE_PARAMS, LOG_PARAMS } from './app.ts'
import { openApiDocument } from './openapi.ts'
import { assertKnownParams, KEY_PARAMETER } from './period.ts'

type Json = Record<string, unknown>

function queryNamesOf(path: string): string[] {
  const document = openApiDocument([{ url: 'https://api.nekolog.io' }]) as Json
  const paths = document.paths as Json
  const route = (paths[path] as Json | undefined)?.get as Json | undefined
  const parameters = (route?.parameters ?? []) as Array<{ name: string; in: string }>
  return parameters
    .filter((one) => one.in === 'query')
    .map((one) => one.name)
    .sort()
}

describe('the parameters each route takes', () => {
  it('are exactly the ones its OpenAPI declares', () => {
    for (const [path, allowed] of [
      ['/v1/logs', LOG_PARAMS],
      ['/v1/histogram', HISTOGRAM_PARAMS],
      ['/v1/issues', ISSUE_PARAMS],
    ] as const) {
      expect([...allowed].sort(), path).toEqual(queryNamesOf(path))
    }
  })
})

describe('refusing a parameter that is not there', () => {
  function params(query: string): URLSearchParams {
    return new URL(`https://api.nekolog.io/v1/logs${query}`).searchParams
  }

  it('says nothing when every name is known', () => {
    expect(() => assertKnownParams(params('?from=1&to=2&limit=3'), LOG_PARAMS)).not.toThrow()
    expect(() => assertKnownParams(params(''), LOG_PARAMS)).not.toThrow()
  })

  it('names the parameter it did not recognise and the ones it takes', () => {
    expect(() => assertKnownParams(params('?period=7d'), LOG_PARAMS)).toThrow(/"period"/)
    expect(() => assertKnownParams(params('?period=7d'), LOG_PARAMS)).toThrow(/from, to, limit/)
  })

  it('leaves the key alone, because the authenticator refuses it with a better message', () => {
    expect(() =>
      assertKnownParams(params(`?${KEY_PARAMETER}=nekolog_sk_x`), LOG_PARAMS),
    ).not.toThrow()
  })

  it('refuses a repeated unknown name once, not once per copy', () => {
    let thrown = 0
    try {
      assertKnownParams(params('?nope=1&nope=2&nope=3'), LOG_PARAMS)
    } catch {
      thrown += 1
    }
    expect(thrown).toBe(1)
  })

  it('refuses a name that only differs by case or by space', () => {
    for (const query of ['?Limit=10', '?+limit=10', '?limit%20=10']) {
      expect(() => assertKnownParams(params(query), LOG_PARAMS), query).toThrow()
    }
  })
})
