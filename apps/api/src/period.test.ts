import { describe, expect, it } from 'vitest'
import { ApiError } from './errors.ts'
import { DEFAULT_PERIOD_MS, MAX_PERIOD_MS, parseCount, parseMoment, parsePeriod } from './period.ts'

const NOW = Date.parse('2026-11-04T12:00:00.000Z')

function query(search: string): URLSearchParams {
  return new URLSearchParams(search)
}

describe('the period, which decides how much ClickHouse is asked to read', () => {
  it('reads the last hour when nobody said otherwise', () => {
    const period = parsePeriod(query(''), NOW)

    expect(period.to.getTime()).toBe(NOW)
    expect(period.from.getTime()).toBe(NOW - DEFAULT_PERIOD_MS)
  })

  it('takes an ISO moment or epoch milliseconds, and nothing else', () => {
    expect(parseMoment('2026-11-04T00:00:00.000Z', 'from').toISOString()).toBe(
      '2026-11-04T00:00:00.000Z',
    )
    expect(parseMoment('1762214400000', 'from').getTime()).toBe(1762214400000)

    for (const value of ['', '   ', 'yesterday', 'NaN', '2026-13-45', '1e9']) {
      expect(() => parseMoment(value, 'from')).toThrow(ApiError)
    }
  })

  it('refuses a period that ends before it starts', () => {
    expect(() =>
      parsePeriod(query('from=2026-11-04T02:00:00Z&to=2026-11-04T01:00:00Z'), NOW),
    ).toThrow(/ends before it starts/)
    expect(() =>
      parsePeriod(query('from=2026-11-04T01:00:00Z&to=2026-11-04T01:00:00Z'), NOW),
    ).toThrow(/ends before it starts/)
  })

  it('refuses a period longer than this API reads, with its own code', () => {
    const from = new Date(NOW - MAX_PERIOD_MS - 1).toISOString()
    const to = new Date(NOW).toISOString()

    try {
      parsePeriod(query(`from=${from}&to=${to}`), NOW)
      expect.unreachable('a period over the cap has to be refused')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).code).toBe('period_too_long')
    }

    expect(() =>
      parsePeriod(query(`from=${new Date(NOW - MAX_PERIOD_MS).toISOString()}&to=${to}`), NOW),
    ).not.toThrow()
  })

  it('defaults from to one hour before an explicit to, not to one hour before now', () => {
    const period = parsePeriod(query('to=2026-01-01T00:00:00.000Z'), NOW)

    expect(period.to.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(period.from.getTime()).toBe(period.to.getTime() - DEFAULT_PERIOD_MS)
  })

  it('bounds a count, and leaves it alone when nobody passed one', () => {
    expect(parseCount(query(''), 'limit', 100, 1000)).toBe(100)
    expect(parseCount(query('limit=250'), 'limit', 100, 1000)).toBe(250)

    for (const raw of ['0', '1001', '-1', '1.5', 'ten', '1e3']) {
      expect(() => parseCount(query(`limit=${raw}`), 'limit', 100, 1000)).toThrow(ApiError)
    }
  })

  it('reads a blank count as one nobody passed, the way every other setting here does', () => {
    expect(parseCount(query('limit='), 'limit', 100, 1000)).toBe(100)
    expect(parseCount(query('limit=   '), 'limit', 100, 1000)).toBe(100)
  })
})
