import { describe, expect, it } from 'vitest'
import { compileSearch, SEARCH_FIELDS } from './compile.ts'
import { SearchError } from './parse.ts'
import { SCOPE_PREFIX, searchWhere } from './scope.ts'

const ENVIRONMENTS = { production: 'env_prod', staging: 'env_stag', 'production-eu': 'env_eu' }

function fails(search: string, options = {}): SearchError {
  try {
    compileSearch(search, options)
  } catch (error) {
    if (error instanceof SearchError) {
      return error
    }
    throw error
  }
  throw new Error(`Expected ${JSON.stringify(search)} to be refused, and it was accepted.`)
}

describe('the translation table of specification 4', () => {
  it.each([
    ['level:error', 'level = {p1:String}', { p1: 'error' }],
    ['service:api-*', 'startsWith(service, {p1:String})', { p1: 'api-' }],
    ['@orderId:123', 'attributes[{p1:String}] = {p2:String}', { p1: 'orderId', p2: '123' }],
    [
      '@status>=500',
      'toFloat64OrNull(attributes[{p1:String}]) >= {p2:Float64}',
      { p1: 'status', p2: '500' },
    ],
    ['timeout', 'hasToken(lower(message), {p1:String})', { p1: 'timeout' }],
    [
      '"payment failed"',
      'positionCaseInsensitive(message, {p1:String}) > 0',
      { p1: 'payment failed' },
    ],
  ])('turns %s into the SQL the specification names', (search, sql, params) => {
    expect(compileSearch(search)).toEqual({ sql, params })
  })

  it('lowercases a word, because the index is over lower(message)', () => {
    expect(compileSearch('TimeOut').params).toEqual({ p1: 'timeout' })
  })

  it('leaves a phrase as it was, because the match is case insensitive anyway', () => {
    expect(compileSearch('"Payment Failed"').params).toEqual({ p1: 'Payment Failed' })
  })
})

describe('how it puts a query together', () => {
  it('uses IN for a list of plain values', () => {
    expect(compileSearch('level:(error OR fatal)')).toEqual({
      sql: 'level IN ({p1:String}, {p2:String})',
      params: { p1: 'error', p2: 'fatal' },
    })
  })

  it('falls back to an OR group when a value in the list is a prefix', () => {
    expect(compileSearch('service:(api-* OR web)').sql).toBe(
      '(startsWith(service, {p1:String}) OR service = {p2:String})',
    )
  })

  it('joins a space with AND and wraps each group', () => {
    expect(compileSearch('level:error service:api').sql).toBe(
      '(level = {p1:String} AND service = {p2:String})',
    )
  })

  it('wraps a negation so nothing leaks past it', () => {
    expect(compileSearch('-level:debug').sql).toBe('NOT (level = {p1:String})')
  })

  it('reads an empty search as everything', () => {
    expect(compileSearch('')).toEqual({ sql: '1', params: {} })
  })

  it('maps each field to its column', () => {
    expect(compileSearch('trace:abc').sql).toBe('trace_id = {p1:String}')
    expect(compileSearch('span:abc').sql).toBe('span_id = {p1:String}')
    expect(compileSearch('session:abc').sql).toBe('session_id = {p1:String}')
    expect(compileSearch('user:u_42').sql).toBe('user_id = {p1:String}')
  })

  it('uses a substring match for a word a token index cannot hold', () => {
    expect(compileSearch('api.timeout').sql).toBe(
      'positionCaseInsensitive(message, {p1:String}) > 0',
    )
  })
})

describe('what it refuses', () => {
  it('names the fields when one of them does not exist', () => {
    const error = fails('status:500')
    expect(error.message).toContain('status')
    for (const field of SEARCH_FIELDS) {
      expect(error.message).toContain(field)
    }
    expect(error.position).toBe(0)
  })

  it('refuses a numeric comparison on anything but an attribute', () => {
    expect(fails('level>=500').message).toMatch(/Only an attribute/)
  })

  it('refuses an attribute name that could not have come from the SDK', () => {
    expect(fails("@a']:x").message).toMatch(/letters, digits/)
    expect(fails('@a=1:x').message).toMatch(/letters, digits/)
  })

  it('refuses an issue that is not a number', () => {
    expect(fails('issue:abc').message).toMatch(/number/)
    expect(fails('issue:12*').message).toMatch(/matched whole/)
  })

  it('refuses env when the caller never said which environments exist', () => {
    expect(fails('env:production').message).toMatch(/which environments exist/)
  })
})

describe('env, which is a name on the way in and an id on the way out', () => {
  const options = { environments: ENVIRONMENTS }

  it('turns the name into the id', () => {
    expect(compileSearch('env:production', options)).toEqual({
      sql: 'environment_id IN ({p1:String})',
      params: { p1: 'env_prod' },
    })
  })

  it('expands a prefix across every name that starts with it', () => {
    expect(compileSearch('env:production*', options).params).toEqual({
      p1: 'env_prod',
      p2: 'env_eu',
    })
  })

  it('matches nothing when the name does not exist, rather than erroring', () => {
    expect(compileSearch('env:prodcution', options)).toEqual({ sql: '0', params: {} })
  })

  it('so a negated typo matches everything, which is the honest answer', () => {
    expect(compileSearch('-env:prodcution', options).sql).toBe('NOT (0)')
  })
})

describe('the scope the server always adds', () => {
  const scope = {
    projectId: 'prj_1',
    environmentIds: ['env_prod', 'env_stag'],
    from: new Date('2026-11-01T00:00:00.000Z'),
    to: new Date('2026-11-03T12:30:45.678Z'),
  }

  it('comes first, and wraps whatever the user wrote', () => {
    const { sql } = searchWhere('level:error OR 1', scope)

    expect(sql).toBe(
      'project_id = {s_project:String} AND ' +
        'environment_id IN ({s_env0:String}, {s_env1:String}) AND ' +
        'timestamp >= {s_from:DateTime64(3)} AND ' +
        'timestamp < {s_to:DateTime64(3)} AND ' +
        '((level = {p1:String} OR hasToken(lower(message), {p2:String})))',
    )
  })

  it('wraps the search even when it is a single condition, so precedence cannot reach out', () => {
    expect(searchWhere('level:error', scope).sql).toMatch(/AND \(level = \{p1:String\}\)$/)
  })

  it('formats the period the way ClickHouse reads it', () => {
    const { params } = searchWhere('', scope)
    expect(params.s_from).toBe('2026-11-01 00:00:00.000')
    expect(params.s_to).toBe('2026-11-03 12:30:45.678')
  })

  it('never lets a search produce a parameter the scope uses', () => {
    const { params } = searchWhere('a b c d e', scope)
    const fromSearch = Object.keys(params).filter((name) => !name.startsWith(SCOPE_PREFIX))

    expect(fromSearch.every((name) => /^p\d+$/.test(name))).toBe(true)
    expect(fromSearch).not.toHaveLength(0)
  })

  it('refuses to build a query with nothing to scope it to', () => {
    expect(() => searchWhere('', { ...scope, environmentIds: [] })).toThrow(/no environment/)
    expect(() => searchWhere('', { ...scope, projectId: '' })).toThrow(/no project/)
  })

  it('refuses a period that ends before it starts', () => {
    expect(() => searchWhere('', { ...scope, to: scope.from })).toThrow(/ends before it starts/)
  })
})

describe('nothing the user types reaches the SQL', () => {
  const hostile = [
    "level:error' OR '1'='1",
    'level:(error OR fatal)) OR 1=1 --',
    '"\\" OR 1=1 --"',
    '@orderId:{p1:String}',
    'level:{s_project:String}',
    "service:';DROP TABLE logs;--",
  ]

  it.each(hostile)('keeps %s entirely inside parameters', (search) => {
    let compiled: { sql: string; params: Record<string, string> }
    try {
      compiled = compileSearch(search, { environments: ENVIRONMENTS })
    } catch (error) {
      expect(error).toBeInstanceOf(SearchError)
      return
    }

    const placeholders = compiled.sql.match(/\{[A-Za-z0-9_]+:[A-Za-z0-9_()]+\}/g) ?? []
    const skeleton = compiled.sql.replace(/\{[A-Za-z0-9_]+:[A-Za-z0-9_()]+\}/g, '?')

    expect(placeholders).toHaveLength(Object.keys(compiled.params).length)
    expect(skeleton).not.toMatch(/['"\\;]|--/)
  })
})
