import { describe, expect, it } from 'vitest'
import {
  attributesFor,
  MAX_PATH_CHARS,
  METHOD_ATTRIBUTE,
  PATH_ATTRIBUTE,
  pathWithoutQuery,
  RENDER_SOURCE_ATTRIBUTE,
  REVALIDATE_REASON_ATTRIBUTE,
  ROUTE_ATTRIBUTE,
  ROUTER_ATTRIBUTE,
} from './request.ts'

describe('the path a failed request had', () => {
  it('is kept', () => {
    expect(pathWithoutQuery('/checkout/payment')).toBe('/checkout/payment')
  })

  it('loses the query string, where the token was', () => {
    expect(pathWithoutQuery('/reset?token=abc123')).toBe('/reset')
  })

  it('loses the fragment too', () => {
    expect(pathWithoutQuery('/callback#access_token=abc')).toBe('/callback')
  })

  it('is cut, so one path cannot eat the attribute budget', () => {
    expect(pathWithoutQuery(`/${'x'.repeat(5_000)}`)).toHaveLength(MAX_PATH_CHARS)
  })

  it.each([undefined, null, 42, '', '   '])('is nothing for %j', (value) => {
    expect(pathWithoutQuery(value)).toBeUndefined()
  })
})

describe('what a server error records', () => {
  it('records the path, the method and where Next was', () => {
    const attributes = attributesFor(
      { path: '/checkout/payment?coupon=SECRET10', method: 'post' },
      {
        routerKind: 'App Router',
        routePath: '/checkout/[step]',
        renderSource: 'react-server-components',
        revalidateReason: 'on-demand',
      },
    )

    expect(attributes).toEqual({
      [PATH_ATTRIBUTE]: '/checkout/payment',
      [METHOD_ATTRIBUTE]: 'POST',
      [ROUTER_ATTRIBUTE]: 'App Router',
      [ROUTE_ATTRIBUTE]: '/checkout/[step]',
      [RENDER_SOURCE_ATTRIBUTE]: 'react-server-components',
      [REVALIDATE_REASON_ATTRIBUTE]: 'on-demand',
    })
  })

  it('never records the headers, which carry the cookie', () => {
    const attributes = attributesFor(
      {
        path: '/checkout',
        method: 'GET',
        headers: { cookie: 'session=abc123', authorization: 'Bearer secret' },
      },
      undefined,
    )

    expect(JSON.stringify(attributes)).not.toContain('abc123')
    expect(JSON.stringify(attributes)).not.toContain('secret')
    expect(Object.keys(attributes).sort()).toEqual([METHOD_ATTRIBUTE, PATH_ATTRIBUTE].sort())
  })

  it('records nothing it was not given', () => {
    expect(attributesFor(undefined, undefined)).toEqual({})
  })

  it('leaves out a field that is not a string', () => {
    const attributes = attributesFor({ path: '/x', method: 7 }, { routerKind: {} })

    expect(attributes).toEqual({ [PATH_ATTRIBUTE]: '/x' })
  })
})
