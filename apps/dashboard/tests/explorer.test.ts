import { describe, expect, it } from 'vitest'
import {
  appendPage,
  DEFAULT_PERIOD,
  instantOf,
  type LogRow,
  levelOf,
  momentOf,
  olderEnd,
  PERIOD_MS,
  PERIODS,
  queryFrom,
  searchOf,
  textOf,
  windowOf,
} from '../lib/explorer'

function line(stamp: string, message = 'hello'): LogRow {
  return { timestamp: stamp, level: 'info', message, service: 'api' }
}

describe('what ClickHouse calls a timestamp', () => {
  it('reads a naive stamp as UTC, which is what the column holds', () => {
    expect(instantOf('2026-11-06 19:04:12.345')).toBe(Date.parse('2026-11-06T19:04:12.345Z'))
  })

  it('does not shift a stamp that already carries a zone', () => {
    expect(instantOf('2026-11-06T19:04:12.345Z')).toBe(Date.parse('2026-11-06T19:04:12.345Z'))
    expect(instantOf('2026-11-06T16:04:12.345-03:00')).toBe(Date.parse('2026-11-06T19:04:12.345Z'))
  })

  it('keeps the milliseconds, because two lines a millisecond apart are two lines', () => {
    const first = instantOf('2026-11-06 19:04:12.345')
    const second = instantOf('2026-11-06 19:04:12.346')

    expect(second - first).toBe(1)
  })

  it('says so rather than inventing a moment when there is none', () => {
    expect(Number.isNaN(instantOf(''))).toBe(true)
    expect(Number.isNaN(momentOf({}))).toBe(true)
  })
})

describe('reading a row the search answered with', () => {
  it('takes a column as text and never as something else', () => {
    expect(textOf({ message: 'up' }, 'message')).toBe('up')
    expect(textOf({ message: 7 }, 'message')).toBe('')
    expect(textOf({}, 'message')).toBe('')
  })

  it('falls back to info for a level this build does not know', () => {
    expect(levelOf({ level: 'fatal' })).toBe('fatal')
    expect(levelOf({ level: 'shouting' })).toBe('info')
    expect(levelOf({})).toBe('info')
  })
})

describe('the period, which is the whole scope of a query', () => {
  it('every period has a length, and they grow', () => {
    const lengths = PERIODS.map((period) => PERIOD_MS[period])

    expect(lengths).toHaveLength(PERIODS.length)
    expect([...lengths].sort((a, b) => a - b)).toEqual(lengths)
  })

  it('ends now and starts a period before it', () => {
    const now = Date.parse('2026-11-06T19:00:00.000Z')
    const span = windowOf('6h', now)

    expect(span.to.getTime()).toBe(now)
    expect(span.from.getTime()).toBe(now - 6 * 60 * 60 * 1000)
  })
})

describe('the query, which lives in the address bar', () => {
  const environments = ['env_a', 'env_b']

  it('takes the environment it was given when the project has it', () => {
    const query = queryFrom(
      new URLSearchParams('env=env_b&q=level%3Aerror&period=7d'),
      environments,
    )

    expect(query).toEqual({ environmentId: 'env_b', search: 'level:error', period: '7d', at: '' })
  })

  it('falls back to the first environment rather than querying one that is not ours', () => {
    const query = queryFrom(new URLSearchParams('env=env_somebody_else'), environments)

    expect(query.environmentId).toBe('env_a')
  })

  it('falls back to the default period rather than trusting the address', () => {
    expect(queryFrom(new URLSearchParams('period=1000y'), environments).period).toBe(DEFAULT_PERIOD)
  })

  it('survives a round trip through the address', () => {
    const query = {
      environmentId: 'env_b',
      search: 'level:error @orderId:ord_0',
      period: '30d',
      at: '2026-11-06T19:04:12.345Z',
    } as const

    expect(queryFrom(new URLSearchParams(searchOf(query)), environments)).toEqual(query)
  })

  it('leaves out what is already the default, so a plain address stays plain', () => {
    const plain = searchOf({ environmentId: 'env_a', search: '', period: DEFAULT_PERIOD, at: '' })

    expect(plain).toBe('env=env_a')
  })
})

describe('paging, which this table does by narrowing the period', () => {
  it('asks for everything up to the oldest line it holds', () => {
    const held = [line('2026-11-06 19:04:12.345'), line('2026-11-06 19:00:00.000')]
    const fallback = new Date('2026-11-06T20:00:00.000Z')

    expect(olderEnd(held, fallback).toISOString()).toBe('2026-11-06T19:00:00.001Z')
  })

  it('keeps the window it was given when it holds nothing yet', () => {
    const fallback = new Date('2026-11-06T20:00:00.000Z')

    expect(olderEnd([], fallback)).toBe(fallback)
  })

  it('drops the line it already had at the boundary instead of showing it twice', () => {
    const boundary = line('2026-11-06 19:00:00.000', 'the oldest one')
    const held = [line('2026-11-06 19:04:12.345'), boundary]
    const page = [{ ...boundary }, line('2026-11-06 18:59:59.000', 'older')]

    const joined = appendPage(held, page)

    expect(joined).toHaveLength(3)
    expect(joined.map((row) => textOf(row, 'message'))).toEqual([
      'hello',
      'the oldest one',
      'older',
    ])
  })

  it('keeps a different line that happens to share the boundary instant', () => {
    const held = [line('2026-11-06 19:00:00.000', 'first')]
    const page = [line('2026-11-06 19:00:00.000', 'second')]

    expect(appendPage(held, page)).toHaveLength(2)
  })

  it('takes the whole page when it holds nothing', () => {
    expect(appendPage([], [line('2026-11-06 19:00:00.000')])).toHaveLength(1)
  })
})
