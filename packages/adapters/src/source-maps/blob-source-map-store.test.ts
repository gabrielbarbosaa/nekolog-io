import { beforeEach, describe, expect, it } from 'vitest'
import { memoryBlobStore } from '../blobs/memory-blob-store.ts'
import { InvalidSourceMap, MAX_SOURCE_MAPS_PER_RELEASE } from '../source-map.ts'
import { blobSourceMapStore, sourceMapPrefix } from './blob-source-map-store.ts'

const encoder = new TextEncoder()
const BODY = encoder.encode(JSON.stringify({ version: 3, sources: [], mappings: 'AAAA' }))

let blobs: ReturnType<typeof memoryBlobStore>
let store: ReturnType<typeof blobSourceMapStore>

beforeEach(() => {
  blobs = memoryBlobStore()
  store = blobSourceMapStore(blobs)
})

describe('the source map store, over whatever blob store it is given', () => {
  it('stores one map under the project and the release', async () => {
    const stored = await store.put({
      projectId: 'prj_1',
      releaseId: 'rel_1',
      name: 'app.js.map',
      body: BODY,
    })

    expect(stored).toMatchObject({
      key: 'sourcemaps/prj_1/rel_1/app.js.map',
      name: 'app.js.map',
      bytes: BODY.length,
      total: 1,
    })
    expect(await blobs.get(stored.key)).not.toBeNull()
  })

  it('counts what this release holds, not what the whole project holds', async () => {
    for (const name of ['a.js.map', 'b.js.map']) {
      await store.put({ projectId: 'prj_1', releaseId: 'rel_1', name, body: BODY })
    }
    const other = await store.put({
      projectId: 'prj_1',
      releaseId: 'rel_2',
      name: 'a.js.map',
      body: BODY,
    })

    expect(other.total).toBe(1)
    expect(await store.list('prj_1', 'rel_1')).toEqual(['a.js.map', 'b.js.map'])
    expect(await store.list('prj_1', 'rel_2')).toEqual(['a.js.map'])
  })

  it('does not raise the count when the same name is uploaded again', async () => {
    const first = await store.put({
      projectId: 'prj_1',
      releaseId: 'rel_1',
      name: 'app.js.map',
      body: BODY,
    })
    const second = await store.put({
      projectId: 'prj_1',
      releaseId: 'rel_1',
      name: 'app.js.map',
      body: encoder.encode(JSON.stringify({ version: 3, sources: ['x'], mappings: 'AACA' })),
    })

    expect(first.total).toBe(1)
    expect(second.total).toBe(1)
    expect(await store.list('prj_1', 'rel_1')).toEqual(['app.js.map'])
  })

  it('refuses a name or a body the gate does not like, before it writes anything', async () => {
    for (const name of ['../escape.map', 'a/b.map', 'app.js']) {
      await expect(
        store.put({ projectId: 'prj_1', releaseId: 'rel_1', name, body: BODY }),
        name,
      ).rejects.toBeInstanceOf(InvalidSourceMap)
    }

    await expect(
      store.put({
        projectId: 'prj_1',
        releaseId: 'rel_1',
        name: 'app.js.map',
        body: encoder.encode('not a map'),
      }),
    ).rejects.toBeInstanceOf(InvalidSourceMap)

    expect(await blobs.list('')).toEqual([])
  })

  it('stops a release from holding more maps than it should', async () => {
    for (let at = 0; at < MAX_SOURCE_MAPS_PER_RELEASE; at += 1) {
      await store.put({
        projectId: 'prj_1',
        releaseId: 'rel_1',
        name: `m${at}.js.map`,
        body: BODY,
      })
    }

    await expect(
      store.put({ projectId: 'prj_1', releaseId: 'rel_1', name: 'one-more.js.map', body: BODY }),
    ).rejects.toThrow(/already holds/)

    await expect(
      store.put({ projectId: 'prj_1', releaseId: 'rel_1', name: 'm0.js.map', body: BODY }),
    ).resolves.toBeTruthy()
  })

  it('names its prefix the same way it reads it back', async () => {
    const stored = await store.put({
      projectId: 'prj_1',
      releaseId: 'rel_1',
      name: 'app.js.map',
      body: BODY,
    })

    expect(stored.key.startsWith(sourceMapPrefix('prj_1', 'rel_1'))).toBe(true)
  })

  it('stores the map as JSON, so whatever serves it says so', async () => {
    const seen: Array<string | undefined> = []
    const spying = {
      ...blobs,
      put: async (key: string, body: Uint8Array | string, contentType?: string) => {
        seen.push(contentType)
        await blobs.put(key, body, contentType)
      },
    }

    await blobSourceMapStore(spying).put({
      projectId: 'prj_1',
      releaseId: 'rel_1',
      name: 'app.js.map',
      body: BODY,
    })

    expect(seen).toEqual(['application/json'])
  })
})
