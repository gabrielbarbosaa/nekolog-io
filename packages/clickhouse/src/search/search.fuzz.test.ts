import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { compileSearch, SEARCH_FIELDS } from './compile.ts'
import { parseSearch, SearchError } from './parse.ts'
import { SCOPE_PREFIX, searchWhere } from './scope.ts'

const RUNS = Number(process.env.FUZZ_RUNS ?? 300)
const FUZZ_TIMEOUT_MS = Math.max(5_000, RUNS * 30)

const ENVIRONMENTS = { production: 'env_prod', staging: 'env_stag' }

const SCOPE = {
  projectId: 'prj_1',
  environmentIds: ['env_prod'],
  from: new Date('2026-10-31T00:00:00.000Z'),
  to: new Date('2026-11-01T00:00:00.000Z'),
}

const PLACEHOLDER = /\{[A-Za-z0-9_]+:[A-Za-z0-9_()]+\}/g

const piece = fc.oneof(
  fc.constantFrom(...SEARCH_FIELDS),
  fc.constantFrom(
    '(',
    ')',
    ':',
    '-',
    '*',
    '"',
    'OR',
    'AND',
    'NOT',
    '@',
    '>',
    '>=',
    '<',
    '<=',
    ' ',
    '500',
    'error',
    'api-*',
    "'",
    ';',
    '--',
    '\\',
    '{p1:String}',
    `{${SCOPE_PREFIX}project:String}`,
    '__proto__',
    'ada@example.com',
  ),
  fc.string({ maxLength: 8 }),
)

const assembled = fc
  .array(piece, { minLength: 1, maxLength: 14 })
  .map((parts) => parts.join(' ').slice(0, 1000))

const anything = fc.oneof(
  assembled,
  fc.string({ maxLength: 160 }),
  fc.string({ unit: 'binary', maxLength: 120 }),
  fc.string({ unit: 'grapheme', maxLength: 80 }),
)

type Outcome = 'parsed' | 'refused'

function attempt(search: string): {
  outcome: Outcome
  sql?: string
  params?: Record<string, string>
} {
  try {
    const compiled = compileSearch(search, { environments: ENVIRONMENTS })
    return { outcome: 'parsed', sql: compiled.sql, params: compiled.params }
  } catch (error) {
    if (!(error instanceof SearchError)) {
      throw error
    }
    return { outcome: 'refused' }
  }
}

function balanced(sql: string): boolean {
  let depth = 0
  for (const character of sql) {
    if (character === '(') {
      depth += 1
    }
    if (character === ')') {
      depth -= 1
      if (depth < 0) {
        return false
      }
    }
  }
  return depth === 0
}

describe('whatever anyone types', { timeout: FUZZ_TIMEOUT_MS }, () => {
  it('is either understood or refused with a position, and never anything else', () => {
    fc.assert(
      fc.property(anything, (search) => {
        try {
          parseSearch(search)
        } catch (error) {
          expect(error).toBeInstanceOf(SearchError)
          const refusal = error as SearchError
          expect(Number.isInteger(refusal.position)).toBe(true)
          expect(refusal.position).toBeGreaterThanOrEqual(0)
          expect(refusal.message).not.toBe('')
        }
      }),
      { numRuns: RUNS },
    )
  })

  it('never reaches the SQL except as a parameter', () => {
    fc.assert(
      fc.property(anything, (search) => {
        const result = attempt(search)
        if (result.outcome === 'refused') {
          return
        }

        const sql = result.sql as string
        const skeleton = sql.replace(PLACEHOLDER, '?')

        expect(skeleton).not.toMatch(/['"\\;]/)
        expect(skeleton).not.toContain('--')
        expect(balanced(sql)).toBe(true)
      }),
      { numRuns: RUNS },
    )
  })

  it('names every parameter it binds, and binds every parameter it names', () => {
    fc.assert(
      fc.property(anything, (search) => {
        const result = attempt(search)
        if (result.outcome === 'refused') {
          return
        }

        const named = (result.sql as string).match(PLACEHOLDER) ?? []
        const bound = Object.keys(result.params as Record<string, string>)

        expect(new Set(named.map((one) => one.slice(1).split(':')[0])).size).toBe(bound.length)
        for (const name of bound) {
          expect(name).toMatch(/^p\d+$/)
        }
      }),
      { numRuns: RUNS },
    )
  })

  it('cannot push the scope out of the way', () => {
    fc.assert(
      fc.property(anything, (search) => {
        let built: { sql: string; params: Record<string, string> }
        try {
          built = searchWhere(search, SCOPE, { environments: ENVIRONMENTS })
        } catch (error) {
          expect(error).toBeInstanceOf(SearchError)
          return
        }

        expect(built.sql.startsWith(`project_id = {${SCOPE_PREFIX}project:String} AND `)).toBe(true)
        expect(built.sql).toContain(`timestamp >= {${SCOPE_PREFIX}from:DateTime64(3)}`)
        expect(built.sql).toContain(`timestamp < {${SCOPE_PREFIX}to:DateTime64(3)}`)
        expect(built.params[`${SCOPE_PREFIX}project`]).toBe(SCOPE.projectId)
        expect(built.params[`${SCOPE_PREFIX}env0`]).toBe('env_prod')
        expect(balanced(built.sql)).toBe(true)
      }),
      { numRuns: RUNS },
    )
  })
})

describe('the fuzzer itself', () => {
  it('reaches both outcomes often enough for the properties to mean anything', () => {
    const counts: Record<Outcome, number> = { parsed: 0, refused: 0 }

    fc.assert(
      fc.property(anything, (search) => {
        counts[attempt(search).outcome] += 1
      }),
      { numRuns: RUNS },
    )

    const total = counts.parsed + counts.refused
    expect(total).toBe(RUNS)
    expect(
      counts.parsed / total,
      `only ${counts.parsed} of ${total} searches parsed`,
    ).toBeGreaterThan(0.1)
    expect(
      counts.refused / total,
      `only ${counts.refused} of ${total} searches were refused`,
    ).toBeGreaterThan(0.1)
  })

  it('generates searches that use more than one condition', () => {
    let several = 0

    fc.assert(
      fc.property(assembled, (search) => {
        const result = attempt(search)
        if (result.outcome === 'parsed' && Object.keys(result.params ?? {}).length >= 2) {
          several += 1
        }
      }),
      { numRuns: RUNS },
    )

    expect(several, 'every generated search compiled to at most one parameter').toBeGreaterThan(
      RUNS * 0.05,
    )
  })
})
