import { describe, expect, it } from 'vitest'
import { headerOf, routeOf, statusOf, statusOfError } from './interceptor.ts'

describe('reading the request', () => {
  it('names the route pattern with the controller prefix in front', () => {
    expect(routeOf({ baseUrl: '/api', route: { path: '/orders/:id' } })).toBe('/api/orders/:id')
  })

  it('says so when nothing matched', () => {
    expect(routeOf({})).toBe('unmatched')
  })

  it('reads a header that arrived more than once', () => {
    expect(headerOf({ headers: { 'x-request-id': ['first', 'second'] } }, 'x-request-id')).toBe(
      'first',
    )
  })

  it('reads nothing out of a header that is not text', () => {
    expect(headerOf({ headers: { 'x-request-id': 42 } }, 'x-request-id')).toBeUndefined()
  })
})

describe('the status of a response', () => {
  it('is what the response says', () => {
    expect(statusOf({ statusCode: 204 })).toBe(204)
  })

  it('is an error when the response says nothing', () => {
    expect(statusOf({})).toBe(500)
  })
})

describe('the status of a thrown error', () => {
  it('asks a nest HttpException what it is', () => {
    expect(statusOfError({ getStatus: () => 404 })).toBe(404)
  })

  it('reads a plain status field', () => {
    expect(statusOfError({ status: 403 })).toBe(403)
  })

  it('is five hundred for an error that says nothing', () => {
    expect(statusOfError(new Error('boom'))).toBe(500)
  })

  it.each([
    ['a success status', { getStatus: () => 200 }],
    ['something that is not a number', { getStatus: () => 'teapot' }],
    [
      'a getStatus that throws',
      {
        getStatus: () => {
          throw new Error('no')
        },
      },
    ],
    ['nothing at all', null],
  ])('is five hundred for %s', (_case, error) => {
    expect(statusOfError(error)).toBe(500)
  })
})
