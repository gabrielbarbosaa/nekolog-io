import { describe, expect, it } from 'vitest'
import type { IssueOccurrence } from '../issue-store.ts'
import { memoryIssueStore } from './memory-issue-store.ts'
import { ISSUE_ID_PREFIX, newIssueId, type SqlRunner, sqlIssueStore } from './sql-issue-store.ts'

const AT = Date.UTC(2026, 10, 3, 12, 0, 0)

function occurrence(overrides: Partial<IssueOccurrence> = {}): IssueOccurrence {
  return {
    projectId: 'prj_1',
    environmentId: 'env_prod',
    fingerprint: '12345678901234567890',
    events: 3,
    firstSeen: AT,
    lastSeen: AT + 1000,
    level: 'error',
    errorType: 'TypeError',
    title: 'Cannot read properties of undefined',
    service: 'checkout-api',
    release: '1.4.2',
    ...overrides,
  }
}

describe('the memory issue store', () => {
  it('opens an issue the first time it sees a fingerprint', async () => {
    const store = memoryIssueStore()

    expect(await store.record([occurrence()])).toEqual({ created: 1, updated: 0, reopened: 0 })
    expect(store.issues()[0]).toMatchObject({ status: 'open', events: 3 })
  })

  it('adds to the one it already has', async () => {
    const store = memoryIssueStore()
    await store.record([occurrence()])

    expect(await store.record([occurrence({ events: 2, lastSeen: AT + 5000 })])).toEqual({
      created: 0,
      updated: 1,
      reopened: 0,
    })

    const [issue] = store.issues()
    expect(issue?.events).toBe(5)
    expect(issue?.lastSeen).toBe(AT + 5000)
    expect(issue?.firstSeen).toBe(AT)
  })

  it('never moves first seen forward or last seen backward, whichever order they arrive in', async () => {
    const older = memoryIssueStore()
    await older.record([occurrence({ firstSeen: AT, lastSeen: AT + 9000 })])
    await older.record([occurrence({ firstSeen: AT - 9000, lastSeen: AT })])

    expect(older.issues()[0]?.firstSeen).toBe(AT - 9000)
    expect(older.issues()[0]?.lastSeen).toBe(AT + 9000)

    const newer = memoryIssueStore()
    await newer.record([occurrence({ firstSeen: AT - 9000, lastSeen: AT })])
    await newer.record([occurrence({ firstSeen: AT, lastSeen: AT + 9000 })])

    expect(newer.issues()[0]?.firstSeen).toBe(AT - 9000)
    expect(newer.issues()[0]?.lastSeen).toBe(AT + 9000)
  })

  it('counts each environment on its own, and adds up within one', async () => {
    const store = memoryIssueStore()
    await store.record([occurrence({ events: 3 })])
    await store.record([occurrence({ environmentId: 'env_stag', events: 7 })])
    await store.record([occurrence({ events: 5 })])

    const [issue] = store.issues()
    expect(issue?.events).toBe(15)
    expect(issue?.byEnvironment.get('env_prod')?.events).toBe(8)
    expect(issue?.byEnvironment.get('env_stag')?.events).toBe(7)
  })

  it('keeps two projects apart even with the same fingerprint', async () => {
    const store = memoryIssueStore()
    await store.record([occurrence()])
    await store.record([occurrence({ projectId: 'prj_2' })])

    expect(store.issues()).toHaveLength(2)
  })

  it('reopens an issue that happens again after it was resolved', async () => {
    const store = memoryIssueStore()
    await store.record([occurrence()])
    store.resolve('prj_1', '12345678901234567890', AT + 2000)

    const rollup = await store.record([occurrence({ lastSeen: AT + 3000 })])

    expect(rollup.reopened).toBe(1)
    expect(store.issues()[0]).toMatchObject({ status: 'open', regressedAt: AT + 3000 })
  })

  it('leaves a resolved issue alone when the occurrence is older than the fix', async () => {
    const store = memoryIssueStore()
    await store.record([occurrence()])
    store.resolve('prj_1', '12345678901234567890', AT + 9000)

    const rollup = await store.record([occurrence({ lastSeen: AT + 3000 })])

    expect(rollup.reopened).toBe(0)
    expect(store.issues()[0]?.status).toBe('resolved')
  })

  it('never reopens an issue somebody chose to ignore', async () => {
    const store = memoryIssueStore()
    await store.record([occurrence()])
    store.ignore('prj_1', '12345678901234567890')

    const rollup = await store.record([occurrence({ lastSeen: AT + 90_000 })])

    expect(rollup.reopened).toBe(0)
    expect(store.issues()[0]?.status).toBe('ignored')
  })

  it('still refuses to reopen one that was resolved and then ignored', async () => {
    const store = memoryIssueStore()
    await store.record([occurrence()])
    store.resolve('prj_1', '12345678901234567890', AT + 2000)
    store.ignore('prj_1', '12345678901234567890')

    const rollup = await store.record([occurrence({ lastSeen: AT + 90_000 })])

    expect(rollup.reopened).toBe(0)
    expect(store.issues()[0]?.status).toBe('ignored')
  })
})

type Call = { text: string; params: readonly unknown[] }

function recordingRunner(answer: (call: Call) => ReadonlyArray<Record<string, unknown>>) {
  const calls: Call[] = []
  const run: SqlRunner = async (text, params) => {
    const call = { text, params }
    calls.push(call)
    return answer(call)
  }
  return { run, calls }
}

describe('the SQL issue store', () => {
  const upserted = (created: boolean, reopened = false) => [{ id: 'iss_x', created, reopened }]

  it('writes the issue and its environment, in that order', async () => {
    const { run, calls } = recordingRunner((call) =>
      call.text.includes('issue_environments') ? [] : upserted(true),
    )

    const rollup = await sqlIssueStore(run, { newId: () => 'iss_fixed' }).record([occurrence()])

    expect(rollup).toEqual({ created: 1, updated: 0, reopened: 0 })
    expect(calls).toHaveLength(2)
    expect(calls[0]?.text).toContain('insert into issues')
    expect(calls[1]?.text).toContain('insert into issue_environments')
    expect(calls[1]?.params[0]).toBe('iss_x')
  })

  it('counts an update rather than a create when the row was already there', async () => {
    const { run } = recordingRunner((call) =>
      call.text.includes('issue_environments') ? [] : upserted(false),
    )

    expect(await sqlIssueStore(run).record([occurrence()])).toEqual({
      created: 0,
      updated: 1,
      reopened: 0,
    })
  })

  it('counts a reopen when the database says the fix was overtaken', async () => {
    const { run } = recordingRunner((call) =>
      call.text.includes('issue_environments') ? [] : upserted(false, true),
    )

    expect(await sqlIssueStore(run).record([occurrence()])).toEqual({
      created: 0,
      updated: 1,
      reopened: 1,
    })
  })

  it('sends every value as a parameter, never as SQL', async () => {
    const { run, calls } = recordingRunner((call) =>
      call.text.includes('issue_environments') ? [] : upserted(true),
    )

    await sqlIssueStore(run).record([
      occurrence({ title: "'; drop table issues; --", projectId: "prj_'" }),
    ])

    for (const call of calls) {
      expect(call.text).not.toContain('drop table')
      expect(call.text).not.toContain("prj_'")
    }
    expect(calls[0]?.params).toContain("'; drop table issues; --")
  })

  it('refuses an occurrence with a moment that is not a moment', async () => {
    const { run } = recordingRunner(() => upserted(true))

    await expect(sqlIssueStore(run).record([occurrence({ lastSeen: Number.NaN })])).rejects.toThrow(
      /seen at/,
    )
  })

  it('does nothing at all for an empty list', async () => {
    const { run, calls } = recordingRunner(() => upserted(true))

    expect(await sqlIssueStore(run).record([])).toEqual({ created: 0, updated: 0, reopened: 0 })
    expect(calls).toHaveLength(0)
  })
})

describe('the id it mints', () => {
  it('has the prefix and the shape the schema demands', () => {
    for (let at = 0; at < 50; at += 1) {
      expect(newIssueId()).toMatch(/^iss_[0-9A-HJKMNP-TV-Z]{26}$/)
    }
    expect(ISSUE_ID_PREFIX).toBe('iss_')
  })

  it('does not repeat', () => {
    const minted = new Set(Array.from({ length: 500 }, () => newIssueId()))
    expect(minted.size).toBe(500)
  })
})
