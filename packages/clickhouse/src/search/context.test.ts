import { describe, expect, it } from 'vitest'
import {
  LOG_COLUMNS,
  type LogContextOptions,
  logContextQuery,
  MAX_CONTEXT_ROWS,
  MAX_CONTEXT_WINDOW_MS,
  SIDE_COLUMN,
} from './context.ts'
import { SCOPE_PREFIX } from './scope.ts'

const ANCHOR = new Date('2026-10-31T12:00:10.000Z')
const SCOPE = { projectId: 'prj_1', environmentId: 'env_prod' }
const TARGET = { database: 'nekolog_dev' }

function build(options: LogContextOptions = {}) {
  return logContextQuery(ANCHOR, SCOPE, TARGET, options)
}

describe('the query it builds', () => {
  it('asks for what came before, what shares the moment, and what came after', () => {
    const { sql } = build()

    expect(sql.match(/UNION ALL/g)).toHaveLength(2)
    expect(sql).toContain(`-1 AS ${SIDE_COLUMN}`)
    expect(sql).toContain(`0 AS ${SIDE_COLUMN}`)
    expect(sql).toContain(`1 AS ${SIDE_COLUMN}`)
    expect(sql.trimEnd().endsWith(`ORDER BY timestamp ASC, ${SIDE_COLUMN} ASC`)).toBe(true)
  })

  it('selects every column of the logs table by default', () => {
    const { sql } = build()
    for (const column of LOG_COLUMNS) {
      expect(sql).toContain(column)
    }
  })

  it('puts the anchor, the window and the limits in parameters', () => {
    const { params } = build({ before: 3, after: 4, atMost: 5, windowMs: 1000 })

    expect(params[`${SCOPE_PREFIX}anchor`]).toBe('2026-10-31 12:00:10.000')
    expect(params[`${SCOPE_PREFIX}window_start`]).toBe('2026-10-31 12:00:09.000')
    expect(params[`${SCOPE_PREFIX}window_end`]).toBe('2026-10-31 12:00:11.000')
    expect(params[`${SCOPE_PREFIX}before`]).toBe('3')
    expect(params[`${SCOPE_PREFIX}after`]).toBe('4')
    expect(params[`${SCOPE_PREFIX}at`]).toBe('5')
  })

  it('scopes every branch to the project and the environment', () => {
    const { sql } = build()
    expect(
      sql.match(new RegExp(`project_id = \\{${SCOPE_PREFIX}project:String\\}`, 'g')),
    ).toHaveLength(3)
    expect(
      sql.match(new RegExp(`environment_id = \\{${SCOPE_PREFIX}env:String\\}`, 'g')),
    ).toHaveLength(3)
  })

  it('wraps the caller search so it cannot reach the scope', () => {
    const { sql } = build({ search: 'level:error OR 1' })
    expect(sql).toContain('((level = {p1:String} OR hasToken(lower(message), {p2:String})))')
  })

  it('reads an absent search as everything', () => {
    expect(build().sql).toContain('AND (1) AND')
  })
})

describe('what it refuses to build', () => {
  it('refuses a column that is not on the table', () => {
    expect(() => build({ columns: ['message', '1, (SELECT 1)'] })).toThrow(/no column called/)
    expect(() => build({ columns: ['retention_days'] })).toThrow(/no column called/)
    expect(() => build({ columns: [] })).toThrow(/selects no column/)
  })

  it('refuses a database or table that is not an identifier', () => {
    expect(() => logContextQuery(ANCHOR, SCOPE, { database: 'a; drop' })).toThrow(/unsafe database/)
    expect(() => logContextQuery(ANCHOR, SCOPE, { database: 'ok', table: 'a-b' })).toThrow(
      /unsafe table/,
    )
  })

  it('refuses a date that is not a date', () => {
    expect(() => logContextQuery(new Date('nope'), SCOPE, TARGET)).toThrow(/not a date/)
  })

  it('refuses a scope with nothing in it', () => {
    expect(() => logContextQuery(ANCHOR, { ...SCOPE, projectId: '' }, TARGET)).toThrow(/scope/)
    expect(() => logContextQuery(ANCHOR, { ...SCOPE, environmentId: '' }, TARGET)).toThrow(/scope/)
  })

  it.each(['before', 'after', 'atMost'] as const)('refuses a silly number of %s rows', (what) => {
    expect(() => build({ [what]: -1 })).toThrow(/whole number/)
    expect(() => build({ [what]: 1.5 })).toThrow(/whole number/)
    expect(() => build({ [what]: MAX_CONTEXT_ROWS + 1 })).toThrow(/whole number/)
    expect(() => build({ [what]: MAX_CONTEXT_ROWS })).not.toThrow()
  })

  it('refuses a window that is zero, fractional or longer than a week', () => {
    expect(() => build({ windowMs: 0 })).toThrow(/whole number/)
    expect(() => build({ windowMs: 1.5 })).toThrow(/whole number/)
    expect(() => build({ windowMs: MAX_CONTEXT_WINDOW_MS + 1 })).toThrow(/whole number/)
    expect(() => build({ windowMs: MAX_CONTEXT_WINDOW_MS })).not.toThrow()
  })
})

describe('the limits this module pins', () => {
  it('are the numbers it documents', () => {
    expect(MAX_CONTEXT_ROWS).toBe(200)
    expect(MAX_CONTEXT_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1000)
    expect(LOG_COLUMNS).toHaveLength(18)
    expect(LOG_COLUMNS).not.toContain('retention_days')
  })
})
