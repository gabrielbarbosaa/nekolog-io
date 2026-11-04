import { describe, expect, it } from 'vitest'
import type { SqlRunner } from '../issues/sql-issue-store.ts'
import { InvalidRelease, MAX_VERSION_CHARS } from '../release-store.ts'
import { newReleaseId, RELEASE_ID_PREFIX, sqlReleaseStore } from './sql-release-store.ts'

const ID = 'rel_0123456789ABCDEFGHJKMNPQRS'

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ID,
    project_id: 'prj_1',
    environment_id: 'env_1',
    version: '1.4.2',
    commit: '9f3a1c7',
    sourcemap_count: 0,
    released_at: new Date('2026-11-04T12:00:00.000Z'),
    created_at: new Date('2026-11-04T12:00:00.000Z'),
    created: true,
    ...over,
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

const options = { newId: () => ID, now: () => Date.parse('2026-11-04T12:00:00.000Z') }

describe('the sql release store, which is the only thing this API writes', () => {
  it('binds every value, including the version and the commit', async () => {
    const { run, calls } = recorder([row()])
    await sqlReleaseStore(run, options).record({
      projectId: `prj'; drop table releases; --`,
      environmentId: 'env_1',
      version: '1.4.2',
      commit: '9f3a1c7',
    })

    expect(calls[0]?.text).not.toContain('drop table')
    expect(calls[0]?.text).toContain('values ($1, $2, $3, $4, $5, $6::timestamptz)')
    expect(calls[0]?.params).toEqual([
      ID,
      `prj'; drop table releases; --`,
      'env_1',
      '1.4.2',
      '9f3a1c7',
      '2026-11-04T12:00:00.000Z',
    ])
  })

  it('is idempotent, keeps the earliest moment and never drops a commit it knows', async () => {
    const { run, calls } = recorder([row({ created: false })])
    const recorded = await sqlReleaseStore(run, options).record({
      projectId: 'prj_1',
      environmentId: 'env_1',
      version: '1.4.2',
    })

    expect(calls[0]?.text).toContain('on conflict (environment_id, version) do update')
    expect(calls[0]?.text).toContain('commit = coalesce(excluded.commit, releases.commit)')
    expect(calls[0]?.text).toContain('released_at = least(releases.released_at')
    expect(recorded.created).toBe(false)
    expect(recorded.release.id).toBe(ID)
  })

  it('never touches the source map count, which belongs to the upload', async () => {
    const { run, calls } = recorder([row({ sourcemap_count: 7 })])
    const recorded = await sqlReleaseStore(run, options).record({
      projectId: 'prj_1',
      environmentId: 'env_1',
      version: '1.4.2',
    })

    expect(calls[0]?.text).not.toContain('sourcemap_count =')
    expect(recorded.release.sourcemapCount).toBe(7)
  })

  it('stamps the moment itself when the caller gave none', async () => {
    const { run, calls } = recorder([row()])
    await sqlReleaseStore(run, options).record({
      projectId: 'prj_1',
      environmentId: 'env_1',
      version: '1.4.2',
    })

    expect(calls[0]?.params[5]).toBe('2026-11-04T12:00:00.000Z')
  })

  it('refuses a version that is blank, padded or too long', async () => {
    const { run } = recorder([row()])
    const store = sqlReleaseStore(run, options)

    for (const version of ['', ' 1.4.2', '1.4.2 ', 'x'.repeat(MAX_VERSION_CHARS + 1)]) {
      await expect(
        store.record({ projectId: 'prj_1', environmentId: 'env_1', version }),
        JSON.stringify(version),
      ).rejects.toBeInstanceOf(InvalidRelease)
    }

    await expect(
      store.record({
        projectId: 'prj_1',
        environmentId: 'env_1',
        version: 'x'.repeat(MAX_VERSION_CHARS),
      }),
    ).resolves.toBeTruthy()
  })

  it('refuses a commit that is not lowercase hexadecimal, and accepts none at all', async () => {
    const { run } = recorder([row()])
    const store = sqlReleaseStore(run, options)

    for (const commit of ['9F3A1C7', 'zzzzzzz', '9f3a1c', 'a'.repeat(41), '9f3a1c7 ']) {
      await expect(
        store.record({ projectId: 'prj_1', environmentId: 'env_1', version: '1.4.2', commit }),
        JSON.stringify(commit),
      ).rejects.toBeInstanceOf(InvalidRelease)
    }

    for (const commit of [null, undefined, '', '9f3a1c7', 'a'.repeat(40)]) {
      await expect(
        store.record({ projectId: 'prj_1', environmentId: 'env_1', version: '1.4.2', commit }),
      ).resolves.toBeTruthy()
    }
  })

  it('refuses a moment that is not a moment, and a scope with a hole in it', async () => {
    const { run } = recorder([row()])
    const store = sqlReleaseStore(run, options)

    await expect(
      store.record({
        projectId: 'prj_1',
        environmentId: 'env_1',
        version: '1.4.2',
        releasedAt: new Date('nope'),
      }),
    ).rejects.toBeInstanceOf(InvalidRelease)

    await expect(
      store.record({ projectId: '', environmentId: 'env_1', version: '1.4.2' }),
    ).rejects.toThrow(/no project and environment/)
  })

  it('mints an id of the shape the database demands', () => {
    const id = newReleaseId()

    expect(id).toMatch(/^rel_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(id.startsWith(RELEASE_ID_PREFIX)).toBe(true)
    expect(newReleaseId()).not.toBe(id)
  })
})
