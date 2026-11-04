import { describe, expect, it } from 'vitest'
import {
  MAX_CONDITIONS,
  MAX_DEPTH,
  MAX_QUERY_CHARS,
  parseSearch,
  SearchError,
  type SearchNode,
} from './parse.ts'

function withoutPositions(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutPositions)
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'at')
      .map(([key, inner]) => [key, withoutPositions(inner)]),
  )
}

function fails(search: string): SearchError {
  try {
    parseSearch(search)
  } catch (error) {
    if (error instanceof SearchError) {
      return error
    }
    throw error
  }
  throw new Error(`Expected ${JSON.stringify(search)} to be refused, and it was accepted.`)
}

describe('every example in specification 4', () => {
  const EXAMPLES = [
    'timeout',
    '"payment failed"',
    'level:error service:api',
    'level:(error OR fatal)',
    'service:api-*',
    '-level:debug',
    '@orderId:123',
    '@status>=500',
    '(service:api OR service:web) -env:dev',
  ]

  it.each(EXAMPLES)('parses %s', (search) => {
    expect(() => parseSearch(search)).not.toThrow()
  })
})

describe('what the grammar means', () => {
  it('reads an empty search as everything', () => {
    expect(parseSearch('')).toEqual({ kind: 'all' })
    expect(parseSearch('   ')).toEqual({ kind: 'all' })
  })

  it('treats a space as AND', () => {
    const node = parseSearch('level:error service:api') as Extract<SearchNode, { kind: 'and' }>
    expect(node.kind).toBe('and')
    expect(node.children).toHaveLength(2)
  })

  it('reads an explicit AND the same way', () => {
    expect(withoutPositions(parseSearch('level:error AND service:api'))).toEqual(
      withoutPositions(parseSearch('level:error service:api')),
    )
  })

  it('binds OR looser than AND', () => {
    const node = parseSearch('a b OR c') as Extract<SearchNode, { kind: 'or' }>
    expect(node.kind).toBe('or')
    expect(node.children[0]).toMatchObject({ kind: 'and' })
    expect(node.children[1]).toMatchObject({ kind: 'term', text: 'c' })
  })

  it('lets brackets beat that', () => {
    const node = parseSearch('a (b OR c)') as Extract<SearchNode, { kind: 'and' }>
    expect(node.kind).toBe('and')
    expect(node.children[1]).toMatchObject({ kind: 'or' })
  })

  it('reads - and NOT as the same negation', () => {
    expect(withoutPositions(parseSearch('-level:debug'))).toEqual(
      withoutPositions(parseSearch('NOT level:debug')),
    )
  })

  it('keeps a dash inside a word', () => {
    expect(parseSearch('service:api-gateway')).toMatchObject({
      kind: 'field',
      field: 'service',
      values: [{ text: 'api-gateway', prefix: false }],
    })
  })

  it('reads a trailing star as a prefix', () => {
    expect(parseSearch('service:api-*')).toMatchObject({
      values: [{ text: 'api-', prefix: true }],
    })
  })

  it('reads an @ as an attribute and a bare word as a field', () => {
    expect(parseSearch('@orderId:123')).toMatchObject({ attribute: true, field: 'orderId' })
    expect(parseSearch('service:api')).toMatchObject({ attribute: false, field: 'service' })
  })

  it('keeps an @ that is inside a word out of it', () => {
    expect(parseSearch('ada@example.com')).toMatchObject({
      kind: 'term',
      text: 'ada@example.com',
    })
  })

  it('reads a phrase with its spaces, and unescapes a quote', () => {
    expect(parseSearch('"payment failed"')).toMatchObject({
      kind: 'term',
      text: 'payment failed',
      phrase: true,
    })
    expect(parseSearch('"say \\"hi\\""')).toMatchObject({ text: 'say "hi"' })
  })

  it('accepts a list of values', () => {
    expect(parseSearch('level:(error OR fatal)')).toMatchObject({
      kind: 'field',
      field: 'level',
      values: [{ text: 'error' }, { text: 'fatal' }],
    })
  })

  it('accepts each comparison operator', () => {
    for (const operator of ['>', '>=', '<', '<='] as const) {
      expect(parseSearch(`@status${operator}500`)).toMatchObject({ kind: 'compare', operator })
    }
  })

  it('accepts a negative and a fractional number', () => {
    expect(parseSearch('@delta>-1.5')).toMatchObject({ value: -1.5 })
  })
})

describe('what it refuses, and where it says the problem is', () => {
  it('points at a quote that never closes', () => {
    const error = fails('"payment failed')
    expect(error.position).toBe(0)
  })

  it('points at a bracket that never closes', () => {
    expect(fails('(service:api').position).toBe(0)
  })

  it('points at a bracket that was never opened', () => {
    expect(fails('service:api)').position).toBe(11)
  })

  it('points at a star in the middle of a value', () => {
    const error = fails('service:a*i')
    expect(error.position).toBe(9)
  })

  it('refuses a star on a word in the message, where it would mean something else', () => {
    expect(fails('time*').message).toMatch(/value of a field/)
  })

  it('points at a colon with nothing after it', () => {
    expect(fails('service:').position).toBe(8)
  })

  it('points at a comparison with no number', () => {
    expect(fails('@status>=high').position).toBe(9)
  })

  it('points at an @ with no attribute name', () => {
    expect(fails('@ :1').position).toBe(0)
  })

  it('points at a keyword with nothing beside it', () => {
    expect(fails('OR').position).toBe(0)
    expect(fails('level:error OR').position).toBe(14)
  })

  it('refuses values inside brackets that are not separated by OR', () => {
    expect(fails('level:(error fatal)').message).toMatch(/separated by OR/)
  })
})

describe('the limits specification 4 sets', () => {
  it('are the numbers the specification writes down, not whatever the code says', () => {
    expect(MAX_QUERY_CHARS).toBe(1000)
    expect(MAX_CONDITIONS).toBe(20)
    expect(MAX_DEPTH).toBe(5)
  })

  it('refuses a 21st condition and a 6th bracket by those numbers', () => {
    expect(fails(Array.from({ length: 21 }, (_, at) => `w${at}`).join(' ')).message).toMatch(/20/)
    expect(fails(`${'('.repeat(6)}timeout${')'.repeat(6)}`).message).toMatch(/5/)
    expect(fails('a'.repeat(1001)).message).toMatch(/1000/)
  })

  it(`refuses a search longer than ${MAX_QUERY_CHARS} characters`, () => {
    const long = 'a'.repeat(MAX_QUERY_CHARS + 1)
    expect(fails(long).message).toMatch(new RegExp(String(MAX_QUERY_CHARS)))
    expect(() => parseSearch('a'.repeat(MAX_QUERY_CHARS))).not.toThrow()
  })

  it(`accepts ${MAX_CONDITIONS} conditions and refuses one more`, () => {
    const fit = Array.from({ length: MAX_CONDITIONS }, (_, at) => `w${at}`).join(' ')
    expect(() => parseSearch(fit)).not.toThrow()

    const over = Array.from({ length: MAX_CONDITIONS + 1 }, (_, at) => `w${at}`).join(' ')
    expect(fails(over).message).toMatch(new RegExp(String(MAX_CONDITIONS)))
  })

  it(`accepts ${MAX_DEPTH} levels of brackets and refuses one more`, () => {
    const nest = (levels: number) => `${'('.repeat(levels)}timeout${')'.repeat(levels)}`
    expect(() => parseSearch(nest(MAX_DEPTH))).not.toThrow()
    expect(fails(nest(MAX_DEPTH + 1)).message).toMatch(new RegExp(String(MAX_DEPTH)))
  })

  it('counts brackets that were closed again as free', () => {
    const wide = Array.from({ length: 8 }, () => '(timeout)').join(' ')
    expect(() => parseSearch(wide)).not.toThrow()
  })
})
