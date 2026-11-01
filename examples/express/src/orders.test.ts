import { describe, expect, it } from 'vitest'
import { statusOf } from './errors.ts'
import { assertOrderId, MAX_TOTAL_CENTS, parseOrder } from './orders.ts'

const VALID = { customerId: 'cus_7f3a91', email: 'ana@exemplo.com', totalCents: 4990 }

function refusal(run: () => unknown): { status: number; message: string } {
  try {
    run()
  } catch (error) {
    return { status: statusOf(error), message: (error as Error).message }
  }
  throw new Error('it accepted something it should have refused')
}

describe('an order id out of the url', () => {
  it('passes when it has the shape the api documents', () => {
    expect(assertOrderId('ord_7f3a91')).toBe('ord_7f3a91')
  })

  it.each([
    ['another prefix', 'cus_7f3a91'],
    ['no prefix', '7f3a91'],
    ['uppercase', 'ord_7F3A91'],
    ['a path traversal attempt', 'ord_../../etc/passwd'],
    ['a newline that would forge a second log line', 'ord_1\nlevel=fatal'],
    ['nothing', ''],
    ['something that is not text', 42],
  ])('is refused with a 400 for %s', (_name, value) => {
    expect(refusal(() => assertOrderId(value)).status).toBe(400)
  })

  it('refuses one that is longer than the pattern allows', () => {
    expect(refusal(() => assertOrderId(`ord_${'a'.repeat(100)}`)).status).toBe(400)
  })
})

describe('an order out of the request body', () => {
  it('passes a well formed one through, trimmed', () => {
    expect(parseOrder({ ...VALID, email: '  ana@exemplo.com  ' })).toEqual(VALID)
  })

  it.each([
    ['a body that is not an object', 'cus_1'],
    ['null', null],
    ['an array, which JSON.parse would also accept', [VALID]],
    ['a missing customer id', { ...VALID, customerId: undefined }],
    ['a customer id of the wrong shape', { ...VALID, customerId: 'ord_7f3a91' }],
    ['a missing email', { ...VALID, email: '   ' }],
    ['a total that is text', { ...VALID, totalCents: '4990' }],
    ['a total of zero', { ...VALID, totalCents: 0 }],
    ['a negative total', { ...VALID, totalCents: -1 }],
    ['a fractional total', { ...VALID, totalCents: 49.9 }],
    ['a total above the ceiling', { ...VALID, totalCents: MAX_TOTAL_CENTS + 1 }],
    ['NaN', { ...VALID, totalCents: Number.NaN }],
  ])('is refused with a 400 for %s', (_name, body) => {
    expect(refusal(() => parseOrder(body)).status).toBe(400)
  })

  it('refuses an email longer than an email can be', () => {
    expect(refusal(() => parseOrder({ ...VALID, email: `${'a'.repeat(255)}@x.com` })).status).toBe(
      400,
    )
  })

  it('says which field it refused, so the client can fix it', () => {
    expect(refusal(() => parseOrder({ ...VALID, email: '' })).message).toContain('email')
  })

  it('ignores fields the caller invented', () => {
    expect(parseOrder({ ...VALID, isAdmin: true, totalCents: 1 })).toEqual({
      ...VALID,
      totalCents: 1,
    })
  })
})
