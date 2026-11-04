import { join, resolve } from 'node:path'
import {
  flatName,
  type RecordedRelease,
  type ReleaseOptions,
  ReleaseRefused,
  type UploadOptions,
  type UploadReport,
} from '@nekolog-io/cli'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ResolvedUpload } from './options.ts'
import { describePublish, type PublishDeps, publishBuild } from './publish.ts'

const KEY = `nekolog_sk_${'a'.repeat(32)}`
const DIR = resolve('/app/dist')

function recorded(over: Record<string, unknown> = {}): RecordedRelease {
  return {
    created: true,
    release: {
      id: 'rel_0123456789ABCDEFGHJKMNPQRS',
      version: '1.4.2',
      commit: null,
      environmentId: 'env_1',
      releasedAt: '2026-11-04T12:00:00.000Z',
      sourcemapCount: 2,
      ...over,
    },
  }
}

function upload(over: Partial<ResolvedUpload> = {}): ResolvedUpload {
  return {
    key: KEY,
    release: '1.4.2',
    commit: null,
    dir: undefined,
    apiUrl: undefined,
    deleteAfterUpload: false,
    silent: true,
    ...over,
  }
}

type Spy = {
  deps: PublishDeps
  releases: ReleaseOptions[]
  uploads: UploadOptions[]
  removed: string[]
  lines: string[]
}

let found: string[]
let report: UploadReport

function spy(over: Partial<PublishDeps> = {}): Spy {
  const releases: ReleaseOptions[] = []
  const uploads: UploadOptions[] = []
  const removed: string[] = []
  const lines: string[] = []

  return {
    releases,
    uploads,
    removed,
    lines,
    deps: {
      createRelease: async (options) => {
        releases.push(options)
        return recorded()
      },
      uploadSourceMaps: async (options) => {
        uploads.push(options)
        return report
      },
      findSourceMaps: async () => found,
      flatName,
      remove: async (file) => {
        removed.push(file)
      },
      log: (line) => {
        lines.push(line)
      },
      ...over,
    },
  }
}

beforeEach(() => {
  found = [join(DIR, 'app.js.map'), join(DIR, 'assets', 'index.mjs.map')]
  report = {
    uploaded: [
      { name: 'app.js.map', bytes: 10, total: 1 },
      { name: 'assets-index.mjs.map', bytes: 20, total: 2 },
    ],
    skipped: [],
  }
})

describe('what the plugin does at the end of a build', () => {
  it('records the release first, then uploads, with the same key and version', async () => {
    const watcher = spy()
    await publishBuild(
      upload({ commit: '9f3a1c7', apiUrl: 'https://api.example.com' }),
      DIR,
      watcher.deps,
    )

    expect(watcher.releases).toEqual([
      { key: KEY, version: '1.4.2', commit: '9f3a1c7', apiUrl: 'https://api.example.com' },
    ])
    expect(watcher.uploads).toEqual([
      { key: KEY, version: '1.4.2', dir: DIR, apiUrl: 'https://api.example.com' },
    ])
  })

  it('never uploads when the release could not be recorded', async () => {
    const watcher = spy({
      createRelease: async () => {
        throw new ReleaseRefused('the API said no')
      },
    })

    await expect(publishBuild(upload(), DIR, watcher.deps)).rejects.toThrow('the API said no')
    expect(watcher.uploads).toEqual([])
  })

  it('lets a refused upload end the build, because a release with no maps is the bug', async () => {
    const watcher = spy({
      uploadSourceMaps: async () => {
        throw new ReleaseRefused('app.js.map: payload_too_large')
      },
    })

    await expect(publishBuild(upload(), DIR, watcher.deps)).rejects.toThrow(/payload_too_large/)
    expect(watcher.removed).toEqual([])
  })
})

describe('which directory it walks', () => {
  it('prefers what the config said over what the bundler reported', async () => {
    const watcher = spy()
    await publishBuild(upload({ dir: 'build' }), DIR, watcher.deps)

    expect(watcher.uploads[0]?.dir).toBe(resolve('build'))
  })

  it('takes what the bundler reported when the config said nothing', async () => {
    const watcher = spy()
    await publishBuild(upload(), DIR, watcher.deps)

    expect(watcher.uploads[0]?.dir).toBe(DIR)
  })

  it('falls back to dist when nobody knows, rather than walking the whole project', async () => {
    const watcher = spy()
    await publishBuild(upload(), undefined, watcher.deps)

    expect(watcher.uploads[0]?.dir).toBe(resolve('dist'))
  })
})

describe('deleting the maps after they are uploaded', () => {
  it('keeps them unless it was asked to delete them', async () => {
    const watcher = spy()
    const published = await publishBuild(upload(), DIR, watcher.deps)

    expect(watcher.removed).toEqual([])
    expect(published.deleted).toEqual([])
  })

  it('deletes exactly the files whose map reached the server', async () => {
    const watcher = spy()
    const published = await publishBuild(upload({ deleteAfterUpload: true }), DIR, watcher.deps)

    expect(watcher.removed).toEqual(found)
    expect(published.deleted).toEqual(found)
  })

  it('leaves a map the upload skipped on disk, because nobody has a copy of it', async () => {
    report = {
      uploaded: [{ name: 'app.js.map', bytes: 10, total: 1 }],
      skipped: ['assets-index.mjs.map is 9000000 bytes, over the 8388608 limit'],
    }
    const watcher = spy()
    const published = await publishBuild(upload({ deleteAfterUpload: true }), DIR, watcher.deps)

    expect(watcher.removed).toEqual([join(DIR, 'app.js.map')])
    expect(published.skipped).toHaveLength(1)
  })

  it('leaves a file the walk finds that the upload never named', async () => {
    found = [...found, join(DIR, 'vendor', 'other.js.map')]
    const watcher = spy()
    await publishBuild(upload({ deleteAfterUpload: true }), DIR, watcher.deps)

    expect(watcher.removed).not.toContain(join(DIR, 'vendor', 'other.js.map'))
  })
})

describe('what it says on the way out', () => {
  it('says nothing at all when it was told to be quiet', async () => {
    const watcher = spy()
    await publishBuild(upload({ silent: true }), DIR, watcher.deps)

    expect(watcher.lines).toEqual([])
  })

  it('names the version, the count and the directory', async () => {
    const watcher = spy()
    await publishBuild(upload({ silent: false }), DIR, watcher.deps)

    expect(watcher.lines.join('\n')).toContain('1.4.2')
    expect(watcher.lines.join('\n')).toContain('2 source map(s)')
    expect(watcher.lines.join('\n')).toContain(DIR)
  })

  it('never writes the key into the build output of a CI log', async () => {
    const watcher = spy()
    await publishBuild(upload({ silent: false, deleteAfterUpload: true }), DIR, watcher.deps)

    expect(watcher.lines.join('\n')).not.toContain(KEY)
  })

  it('tells a rerun apart from a first run', () => {
    const base = { dir: DIR, uploaded: ['app.js.map'], skipped: [], deleted: [] }

    expect(describePublish({ ...base, release: recorded() })[0]).toMatch(/recorded 1\.4\.2/)
    expect(describePublish({ ...base, release: { ...recorded(), created: false } })[0]).toMatch(
      /already recorded/,
    )
  })

  it('names every map it skipped, so nobody finds out from a broken stack trace', () => {
    const lines = describePublish({
      release: recorded(),
      dir: DIR,
      uploaded: [],
      skipped: ['huge.js.map is too big'],
      deleted: [],
    })

    expect(lines.join('\n')).toContain('huge.js.map is too big')
  })
})
