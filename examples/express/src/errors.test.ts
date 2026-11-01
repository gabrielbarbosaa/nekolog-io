import { describe, expect, it } from 'vitest'
import { httpError, publicMessageOf, statusOf } from './errors.ts'

describe('the status an error asks for', () => {
  it('is the one an httpError carries', () => {
    expect(statusOf(httpError(404, 'nope'))).toBe(404)
  })

  it.each([
    ['a plain error', new Error('boom')],
    ['a status below the http error range', Object.assign(new Error('x'), { status: 200 })],
    ['a status above it', Object.assign(new Error('x'), { status: 600 })],
    ['a status that is not a whole number', Object.assign(new Error('x'), { status: 404.5 })],
    ['a status the caller smuggled in as text', Object.assign(new Error('x'), { status: '404' })],
    ['something that is not an error at all', 'boom'],
    ['null', null],
    ['undefined', undefined],
  ])('falls back to 500 for %s', (_name, error) => {
    expect(statusOf(error)).toBe(500)
  })
})

describe('what the client is allowed to read', () => {
  it('never repeats the message of a server error', () => {
    const error = new Error('the payment gateway at 10.0.3.14 timed out')

    expect(publicMessageOf(error, 500)).toBe('Internal Server Error')
    expect(publicMessageOf(error, 500)).not.toContain('10.0.3.14')
  })

  it('repeats the message of a client error, which the client caused', () => {
    expect(publicMessageOf(httpError(400, '"totalCents" must be a number'), 400)).toBe(
      '"totalCents" must be a number',
    )
  })

  it('still says something when a client error carries no message', () => {
    expect(publicMessageOf(new Error(''), 400)).toBe('Bad Request')
    expect(publicMessageOf(null, 400)).toBe('Bad Request')
  })
})
