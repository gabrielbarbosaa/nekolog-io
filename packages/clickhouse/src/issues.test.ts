import { describe, expect, it } from 'vitest'
import {
  clickHouseIssueSource,
  MAX_ISSUE_TITLE_CHARS,
  occurrenceFrom,
  rollupStatement,
} from './issues.ts'

const CONFIG = { url: 'http://localhost:8123', database: 'nekolog_dev', user: 'u', password: 'p' }

function row(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'prj_1',
    environmentId: 'env_prod',
    fingerprint: '12345678901234567890',
    events: '3',
    firstSeen: '1762171200000',
    lastSeen: '1762171260000',
    level: 'error',
    errorType: 'TypeError',
    title: 'boom',
    service: 'api',
    release: '1.0.0',
    ...overrides,
  }
}

describe('the statement it sends', () => {
  it('windows by received_at, never by the timestamp the client chose', () => {
    const sql = rollupStatement('nekolog_dev', 'logs')

    expect(sql).toContain('received_at >= fromUnixTimestamp64Milli({from:Int64})')
    expect(sql).toContain('received_at < fromUnixTimestamp64Milli({to:Int64})')
    expect(sql).not.toContain('timestamp >=')
  })

  it('still reports first and last seen from the timestamp people read', () => {
    const sql = rollupStatement('nekolog_dev', 'logs')

    expect(sql).toContain('min(timestamp)')
    expect(sql).toContain('max(timestamp)')
  })

  it('leaves out the rows that were never fingerprinted', () => {
    expect(rollupStatement('nekolog_dev', 'logs')).toContain('WHERE logs.fingerprint != 0')
  })

  it('groups by project, environment and fingerprint, and nothing else', () => {
    expect(rollupStatement('nekolog_dev', 'logs')).toContain(
      'GROUP BY project_id, environment_id, fingerprint',
    )
  })

  it('refuses a database or table that is not an identifier', () => {
    expect(() => rollupStatement('a; drop', 'logs')).toThrow(/unsafe database/)
    expect(() => rollupStatement('ok', 'a-b')).toThrow(/unsafe table/)
  })
})

describe('reading a row back', () => {
  it('takes a whole one', () => {
    expect(occurrenceFrom(row())).toEqual({
      projectId: 'prj_1',
      environmentId: 'env_prod',
      fingerprint: '12345678901234567890',
      events: 3,
      firstSeen: 1_762_171_200_000,
      lastSeen: 1_762_171_260_000,
      level: 'error',
      errorType: 'TypeError',
      title: 'boom',
      service: 'api',
      release: '1.0.0',
    })
  })

  it('keeps a fingerprint that does not fit in a number, because it is text all the way', () => {
    const taken = occurrenceFrom(row({ fingerprint: '18446744073709551615' }))
    expect(taken?.fingerprint).toBe('18446744073709551615')
  })

  it.each([
    ['no project', { projectId: '' }],
    ['no environment', { environmentId: '' }],
    ['the unresolved fingerprint', { fingerprint: '0' }],
    ['a fingerprint that is not a number', { fingerprint: 'abc' }],
    ['no events', { events: '0' }],
    ['events that are not a number', { events: 'many' }],
    ['last seen before first seen', { lastSeen: '1762171100000' }],
  ])('drops a row with %s', (_what, overrides) => {
    expect(occurrenceFrom(row(overrides))).toBeUndefined()
  })

  it('cuts a title that would fill the column', () => {
    const taken = occurrenceFrom(row({ title: 'x'.repeat(MAX_ISSUE_TITLE_CHARS + 500) }))
    expect(taken?.title).toHaveLength(MAX_ISSUE_TITLE_CHARS)
  })

  it('falls back to the error type, and then to a word, rather than an empty title', () => {
    expect(occurrenceFrom(row({ title: '' }))?.title).toBe('TypeError')
    expect(occurrenceFrom(row({ title: '', errorType: '' }))?.title).toBe('Error')
  })
})

describe('the source', () => {
  it('refuses a window that does not move forward', async () => {
    const source = clickHouseIssueSource(CONFIG)

    await expect(source.occurrencesBetween({ from: 10, to: 10 })).rejects.toThrow(/move forward/)
    await expect(source.occurrencesBetween({ from: 10, to: 5 })).rejects.toThrow(/move forward/)
    await expect(source.occurrencesBetween({ from: Number.NaN, to: 5 })).rejects.toThrow(
      /move forward/,
    )
  })

  it('sends the window and the limit as parameters', async () => {
    let sent: URL | undefined
    const source = clickHouseIssueSource(CONFIG, {
      limit: 7,
      fetch: (async (url: URL) => {
        sent = url
        return new Response('', { status: 200 })
      }) as unknown as typeof fetch,
    })

    await source.occurrencesBetween({ from: 1000, to: 2000 })

    expect(sent?.searchParams.get('param_from')).toBe('1000')
    expect(sent?.searchParams.get('param_to')).toBe('2000')
    expect(sent?.searchParams.get('param_limit')).toBe('7')
  })
})
