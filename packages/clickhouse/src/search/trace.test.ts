import { describe, expect, it } from 'vitest'
import { LOG_COLUMNS } from './context.ts'
import { SCOPE_PREFIX, type SearchScope } from './scope.ts'
import {
  DEFAULT_TRACE_ROWS,
  type LogTraceOptions,
  logTraceQuery,
  MAX_TRACE_ROWS,
  MAX_TRACE_SPAN_MS,
  TRACE_ID_CHARS,
  traceIdOf,
} from './trace.ts'

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736'
const TARGET = { database: 'nekolog_dev' }

function scope(overrides: Partial<SearchScope> = {}): SearchScope {
  return {
    projectId: 'prj_1',
    environmentIds: ['env_prod'],
    from: new Date('2026-10-31T11:00:00.000Z'),
    to: new Date('2026-10-31T13:00:00.000Z'),
    ...overrides,
  }
}

function build(traceId: string = TRACE, options: LogTraceOptions = {}, over = {}) {
  return logTraceQuery(traceId, scope(over), TARGET, options)
}

describe('the trace id it accepts', () => {
  it('is the documented width, in hexadecimal', () => {
    expect(TRACE_ID_CHARS).toBe(32)
    expect(traceIdOf(TRACE)).toBe(TRACE)
  })

  it('lowercases what it was given, so one trace is one trace', () => {
    expect(traceIdOf(TRACE.toUpperCase())).toBe(TRACE)
    expect(traceIdOf('4BF92f3577B34da6A3ce929D0e0E4736')).toBe(TRACE)
  })

  it('refuses the empty one, which every row without a trace carries', () => {
    expect(() => traceIdOf('')).toThrow(/empty trace id/)
  })

  it('refuses anything that is not a trace id', () => {
    for (const bad of ['short', `${TRACE}0`, TRACE.replace('4', 'z'), ' '.repeat(32)]) {
      expect(() => traceIdOf(bad), bad).toThrow()
    }
  })
})

describe('the query it builds', () => {
  it('scopes on the project, the environments and the period, and on the trace', () => {
    const { sql, params } = build()

    expect(sql).toContain(`project_id = {${SCOPE_PREFIX}project:String}`)
    expect(sql).toContain(`environment_id IN ({${SCOPE_PREFIX}env0:String})`)
    expect(sql).toContain(`trace_id = {${SCOPE_PREFIX}trace:String}`)
    expect(params[`${SCOPE_PREFIX}trace`]).toBe(TRACE)
  })

  it('never puts the trace id in the statement itself', () => {
    const { sql } = build()
    expect(sql).not.toContain(TRACE)
  })

  it('reads oldest first, because it is a timeline', () => {
    const { sql } = build()
    expect(sql).toContain('ORDER BY timestamp ASC, received_at ASC')
  })

  it('selects every column of the logs table by default', () => {
    const { sql } = build()
    for (const column of LOG_COLUMNS) {
      expect(sql).toContain(column)
    }
  })

  it('carries the default limit, and takes one that is asked for', () => {
    expect(build().params[`${SCOPE_PREFIX}limit`]).toBe(String(DEFAULT_TRACE_ROWS))
    expect(build(TRACE, { limit: 7 }).params[`${SCOPE_PREFIX}limit`]).toBe('7')
  })

  it('refuses a limit outside what it will serve', () => {
    for (const limit of [0, -1, 1.5, MAX_TRACE_ROWS + 1]) {
      expect(() => build(TRACE, { limit }), String(limit)).toThrow()
    }
  })

  it('refuses a column the table does not have', () => {
    expect(() => build(TRACE, { columns: ['retention_days'] })).toThrow(/no column called/)
  })

  it('refuses a window wider than a day, because the table is partitioned by day', () => {
    const from = new Date('2026-10-30T00:00:00.000Z')
    const tooWide = { from, to: new Date(from.getTime() + MAX_TRACE_SPAN_MS + 1) }
    const theWidest = { from, to: new Date(from.getTime() + MAX_TRACE_SPAN_MS) }

    expect(() => build(TRACE, {}, tooWide)).toThrow(/partitioned by day/)
    expect(() => build(TRACE, {}, theWidest)).not.toThrow()
  })

  it('refuses a scope with no environment, rather than reading the whole project', () => {
    expect(() => build(TRACE, {}, { environmentIds: [] })).toThrow()
  })
})
