import { describe, expect, it } from 'vitest'
import {
  decodeIssueCursor,
  encodeIssueCursor,
  IssueCursorError,
  MAX_ISSUE_ROWS,
} from '../issue-reader.ts'
import { ISSUE_STATUSES } from '../issue-store.ts'
import { sqlIssueReader } from './sql-issue-reader.ts'
import type { SqlRunner } from './sql-issue-store.ts'

const ID = 'iss_0123456789ABCDEFGHJKMNPQRS'
const OTHER = 'iss_ZZZZZZZZZZZZZZZZZZZZZZZZZZ'

function row(id: string, lastSeen: string): Record<string, unknown> {
  return {
    id,
    fingerprint: '18446744073709551615',
    status: 'open',
    title: 'TypeError: cannot read properties of undefined',
    error_type: 'TypeError',
    service: 'checkout',
    events: 7,
    first_seen_at: new Date('2026-11-01T00:00:00.000Z'),
    last_seen_at: new Date(lastSeen),
    resolved_at: null,
    regressed_at: null,
  }
}

function recorder(rows: Array<Record<string, unknown>>): {
  run: SqlRunner
  calls: Array<{ text: string; params: readonly unknown[] }>
} {
  const calls: Array<{ text: string; params: readonly unknown[] }> = []
  return {
    calls,
    run: async (text, params) => {
      calls.push({ text, params })
      return rows
    },
  }
}

describe('the sql issue reader, which is what the public API lists', () => {
  it('scopes to one project and one environment, through the environment table', async () => {
    const { run, calls } = recorder([])
    await sqlIssueReader(run).list({ projectId: 'prj_1', environmentId: 'env_1' })

    const call = calls[0]
    expect(call?.text).toContain('join issue_environments e on e.issue_id = i.id')
    expect(call?.params[0]).toBe('prj_1')
    expect(call?.params[1]).toBe('env_1')
  })

  it('makes the project and the environment conditions nobody can disjoin away', async () => {
    const { run, calls } = recorder([])
    await sqlIssueReader(run).list({ projectId: 'prj_1', environmentId: 'env_1' })

    const text = calls[0]?.text ?? ''
    expect(text).toMatch(/\nwhere i\.project_id = \$1\n/)
    expect(text).toMatch(/\n {2}and e\.environment_id = \$2\n/)

    const scope = text.slice(text.indexOf('\nwhere '), text.indexOf('\norder by '))
    expect(scope).not.toMatch(/\btrue\b/)

    const disjunctions = [...scope.matchAll(/\bor\b/g)].map((match) =>
      scope.slice(Math.max(0, (match.index ?? 0) - 30), match.index ?? 0).replace(/\s+/g, ' '),
    )
    expect(disjunctions.length).toBeGreaterThan(0)
    for (const before of disjunctions) {
      expect(before, `an "or" that is not a null guard: …${before}or…`).toContain('is null')
    }
  })

  it('binds every value, and puts nothing a caller typed into the statement', async () => {
    const { run, calls } = recorder([])
    await sqlIssueReader(run).list({
      projectId: `prj'; drop table issues; --`,
      environmentId: 'env_1',
      statuses: ['resolved'],
    })

    expect(calls[0]?.text).not.toContain('drop table')
    expect(calls[0]?.params).toContain(`prj'; drop table issues; --`)
    expect(calls[0]?.params[2]).toEqual(['resolved'])
  })

  it('looks at every status when the caller named none', async () => {
    const { run, calls } = recorder([])
    await sqlIssueReader(run).list({ projectId: 'prj_1', environmentId: 'env_1' })

    expect(calls[0]?.params[2]).toEqual([...ISSUE_STATUSES])
  })

  it('refuses a status nobody defined', async () => {
    const { run } = recorder([])
    await expect(
      sqlIssueReader(run).list({
        projectId: 'prj_1',
        environmentId: 'env_1',
        statuses: ['deleted' as never],
      }),
    ).rejects.toThrow(/no issue status called/)
  })

  it('asks for one row more than the page, and hands back a cursor only when there is one', async () => {
    const full = recorder([row(ID, '2026-11-04T10:00:00.000Z'), row(OTHER, '2026-11-04T09:00:00Z')])
    const page = await sqlIssueReader(full.run).list({
      projectId: 'prj_1',
      environmentId: 'env_1',
      limit: 1,
    })

    expect(full.calls[0]?.params[7]).toBe(2)
    expect(page.issues).toHaveLength(1)
    expect(page.nextCursor).toBe(encodeIssueCursor('2026-11-04T10:00:00.000Z', ID))

    const last = recorder([row(ID, '2026-11-04T10:00:00.000Z')])
    const final = await sqlIssueReader(last.run).list({
      projectId: 'prj_1',
      environmentId: 'env_1',
      limit: 1,
    })
    expect(final.nextCursor).toBeNull()
  })

  it('pages by the pair the rows are ordered on, not by an offset', async () => {
    const { run, calls } = recorder([])
    await sqlIssueReader(run).list({
      projectId: 'prj_1',
      environmentId: 'env_1',
      cursor: encodeIssueCursor('2026-11-04T10:00:00.000Z', ID),
    })

    expect(calls[0]?.text).toContain('(e.last_seen_at, i.id) < ($6::timestamptz, $7::text)')
    expect(calls[0]?.text).not.toContain('offset')
    expect(calls[0]?.params[5]).toBe('2026-11-04T10:00:00.000Z')
    expect(calls[0]?.params[6]).toBe(ID)
  })

  it('refuses a cursor it did not hand out', () => {
    for (const cursor of [
      '',
      '|',
      'nope',
      `2026-11-04T10:00:00.000Z|' or 1=1`,
      `not-a-date|${ID}`,
    ]) {
      expect(() => decodeIssueCursor(cursor)).toThrow(IssueCursorError)
    }
    expect(decodeIssueCursor(encodeIssueCursor('2026-11-04T10:00:00.000Z', ID))).toEqual({
      lastSeen: '2026-11-04T10:00:00.000Z',
      id: ID,
    })
  })

  it('reads the events of this environment, not of the whole project', async () => {
    const { run, calls } = recorder([row(ID, '2026-11-04T10:00:00.000Z')])
    const page = await sqlIssueReader(run).list({ projectId: 'prj_1', environmentId: 'env_1' })

    expect(calls[0]?.text).toContain('e.events as events')
    expect(page.issues[0]?.events).toBe(7)
    expect(page.issues[0]?.fingerprint).toBe('18446744073709551615')
    expect(page.issues[0]?.lastSeen).toBe('2026-11-04T10:00:00.000Z')
    expect(page.issues[0]?.resolvedAt).toBeNull()
  })

  it('refuses a page size outside the range, and a scope with a hole in it', async () => {
    const { run } = recorder([])
    for (const limit of [0, -1, 1.5, MAX_ISSUE_ROWS + 1]) {
      await expect(
        sqlIssueReader(run).list({ projectId: 'prj_1', environmentId: 'env_1', limit }),
      ).rejects.toThrow(/Refusing to ask for/)
    }
    await expect(
      sqlIssueReader(run).list({ projectId: '', environmentId: 'env_1' }),
    ).rejects.toThrow(/no project and environment/)
  })
})
