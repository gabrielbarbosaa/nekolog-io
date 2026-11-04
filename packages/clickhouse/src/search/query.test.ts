import { describe, expect, it } from 'vitest'
import { SearchError } from './parse.ts'
import { DEFAULT_SEARCH_ROWS, logSearchQuery, MAX_SEARCH_ROWS, searchColumnsOf } from './query.ts'
import type { SearchScope } from './scope.ts'

const SCOPE: SearchScope = {
  projectId: 'prj_01HZX',
  environmentIds: ['env_01HZY'],
  from: new Date('2026-11-04T00:00:00.000Z'),
  to: new Date('2026-11-04T01:00:00.000Z'),
}

describe('the log search query, which is what the public API runs', () => {
  it('scopes every query to one project, one environment and one period', () => {
    const built = logSearchQuery('', SCOPE, { database: 'nekolog_dev' })

    expect(built.sql).toContain('FROM nekolog_dev.logs')
    expect(built.sql).toContain('project_id = {s_project:String}')
    expect(built.sql).toContain('environment_id IN ({s_env0:String})')
    expect(built.sql).toContain('timestamp >= {s_from:DateTime64(3)}')
    expect(built.sql).toContain('timestamp < {s_to:DateTime64(3)}')
    expect(built.params.s_project).toBe('prj_01HZX')
    expect(built.params.s_env0).toBe('env_01HZY')
  })

  it('binds every value the caller typed, and interpolates none of it', () => {
    const hostile = `' OR 1=1 --`
    const built = logSearchQuery(`service:${JSON.stringify(hostile)}`, SCOPE, {
      database: 'nekolog_dev',
    })

    expect(built.sql).not.toContain('OR 1=1')
    expect(Object.values(built.params)).toContain(hostile)
  })

  it('refuses env:, because the key already says which environment this is', () => {
    expect(() => logSearchQuery('env:prod', SCOPE, { database: 'nekolog_dev' })).toThrow(
      SearchError,
    )
  })

  it('reads newest first unless asked for the other way round', () => {
    expect(logSearchQuery('', SCOPE, { database: 'nekolog_dev' }).sql).toContain(
      'ORDER BY timestamp DESC',
    )
    expect(
      logSearchQuery('', SCOPE, { database: 'nekolog_dev' }, { order: 'oldest' }).sql,
    ).toContain('ORDER BY timestamp ASC')
  })

  it('binds the limit instead of writing it into the statement', () => {
    const built = logSearchQuery('', SCOPE, { database: 'nekolog_dev' }, { limit: 250 })

    expect(built.sql).toMatch(/LIMIT \{s_limit:UInt32\}$/)
    expect(built.sql).not.toContain('LIMIT 250')
    expect(built.params.s_limit).toBe('250')
  })

  it('carries the limit as a parameter, and refuses one outside the range', () => {
    expect(logSearchQuery('', SCOPE, { database: 'nekolog_dev' }).params.s_limit).toBe(
      String(DEFAULT_SEARCH_ROWS),
    )
    expect(
      logSearchQuery('', SCOPE, { database: 'nekolog_dev' }, { limit: MAX_SEARCH_ROWS }).params
        .s_limit,
    ).toBe(String(MAX_SEARCH_ROWS))

    for (const limit of [0, -1, 1.5, MAX_SEARCH_ROWS + 1, Number.NaN]) {
      expect(() => logSearchQuery('', SCOPE, { database: 'nekolog_dev' }, { limit })).toThrow()
    }
  })

  it('selects only columns the logs table has', () => {
    expect(searchColumnsOf(['level', 'message'])).toEqual(['level', 'message'])
    expect(() => searchColumnsOf(['level', 'password'])).toThrow(/no column called/)
    expect(() => searchColumnsOf([])).toThrow(/selects no column/)
  })

  it('refuses a database name that is not an identifier', () => {
    expect(() => logSearchQuery('', SCOPE, { database: 'nekolog; drop' })).toThrow(/unsafe/)
  })

  it('refuses a scope with no environment, rather than reading the whole project', () => {
    expect(() =>
      logSearchQuery('', { ...SCOPE, environmentIds: [] }, { database: 'nekolog_dev' }),
    ).toThrow(/no environment/)
  })
})
