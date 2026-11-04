import { describe, expect, it } from 'vitest'
import {
  bucketSecondsFor,
  chooseBucket,
  DEFAULT_HISTOGRAM_BUCKET,
  HISTOGRAM_BUCKET_SECONDS,
  HISTOGRAM_BUCKETS,
  logHistogramQuery,
  MAX_HISTOGRAM_BUCKETS,
} from './histogram.ts'
import type { SearchScope } from './scope.ts'

const SCOPE: SearchScope = {
  projectId: 'prj_01HZX',
  environmentIds: ['env_01HZY'],
  from: new Date('2026-11-04T00:00:00.000Z'),
  to: new Date('2026-11-04T01:00:00.000Z'),
}

describe('the histogram query, which is the chart behind the search', () => {
  it('groups by a bucket that came from the closed list, never from the caller', () => {
    const built = logHistogramQuery('', SCOPE, { database: 'nekolog_dev' }, { bucket: '5m' })

    expect(built.sql).toContain('toStartOfInterval(timestamp, INTERVAL 300 SECOND) AS bucket')
    expect(built.sql).toContain('GROUP BY bucket, level')
    expect(built.sql).toContain('ORDER BY bucket ASC, level ASC')
  })

  it('refuses a bucket nobody offered, including one shaped like SQL', () => {
    for (const bucket of ['7m', '', '1 SECOND), count() FROM x --', '1M']) {
      expect(() => logHistogramQuery('', SCOPE, { database: 'nekolog_dev' }, { bucket })).toThrow(
        /no bucket called/,
      )
    }
  })

  it('keeps the same scope the search does', () => {
    const built = logHistogramQuery('level:error', SCOPE, { database: 'nekolog_dev' })

    expect(built.sql).toContain('project_id = {s_project:String}')
    expect(built.sql).toContain('environment_id IN ({s_env0:String})')
    expect(built.params.s_project).toBe('prj_01HZX')
    expect(built.sql).not.toContain("'error'")
    expect(Object.values(built.params)).toContain('error')
  })

  it('defaults to five minutes', () => {
    expect(bucketSecondsFor(undefined)).toBe(HISTOGRAM_BUCKET_SECONDS[DEFAULT_HISTOGRAM_BUCKET])
    expect(logHistogramQuery('', SCOPE, { database: 'nekolog_dev' }).sql).toContain(
      `INTERVAL ${HISTOGRAM_BUCKET_SECONDS[DEFAULT_HISTOGRAM_BUCKET]} SECOND`,
    )
  })

  it('refuses a period that would be more points than it returns', () => {
    const wide: SearchScope = {
      ...SCOPE,
      to: new Date(SCOPE.from.getTime() + (MAX_HISTOGRAM_BUCKETS + 1) * 60 * 1000),
    }

    expect(() =>
      logHistogramQuery('', wide, { database: 'nekolog_dev' }, { bucket: '1m' }),
    ).toThrow(/the most is/)
    expect(() =>
      logHistogramQuery('', wide, { database: 'nekolog_dev' }, { bucket: '1h' }),
    ).not.toThrow()
  })

  it('picks a bucket wide enough for the period when nobody asked for one', () => {
    expect(chooseBucket(SCOPE, undefined)).toBe(HISTOGRAM_BUCKETS[0])

    const year: SearchScope = {
      ...SCOPE,
      to: new Date(SCOPE.from.getTime() + 365 * 24 * 60 * 60 * 1000),
    }
    expect(HISTOGRAM_BUCKETS).toContain(chooseBucket(year, undefined))
    expect(chooseBucket(year, '1h')).toBe('1h')
  })

  it('never inherits a prototype property as a bucket', () => {
    for (const name of ['constructor', 'toString', '__proto__']) {
      expect(() => bucketSecondsFor(name)).toThrow(/no bucket called/)
    }
  })
})
