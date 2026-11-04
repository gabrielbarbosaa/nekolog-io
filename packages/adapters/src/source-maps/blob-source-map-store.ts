import type { BlobStore } from '../blob-store.ts'
import {
  assertSourceMapBody,
  assertSourceMapName,
  InvalidSourceMap,
  MAX_SOURCE_MAPS_PER_RELEASE,
  SOURCE_MAP_CONTENT_TYPE,
  SOURCE_MAP_PREFIX,
  sourceMapKey,
} from '../source-map.ts'

export interface SourceMapUpload {
  projectId: string
  releaseId: string
  name: string
  body: Uint8Array
}

export interface StoredSourceMap {
  key: string
  name: string
  bytes: number
  total: number
}

export interface SourceMapStore {
  put(upload: SourceMapUpload): Promise<StoredSourceMap>
  list(projectId: string, releaseId: string): Promise<ReadonlyArray<string>>
}

export function sourceMapPrefix(projectId: string, releaseId: string): string {
  return `${SOURCE_MAP_PREFIX}/${projectId}/${releaseId}/`
}

export function blobSourceMapStore(blobs: BlobStore): SourceMapStore {
  const listing = async (projectId: string, releaseId: string): Promise<ReadonlyArray<string>> => {
    const prefix = sourceMapPrefix(projectId, releaseId)
    const keys = await blobs.list(prefix, MAX_SOURCE_MAPS_PER_RELEASE + 1)
    return keys.map((key) => key.slice(prefix.length)).filter((name) => name !== '')
  }

  return {
    list: listing,

    async put(upload: SourceMapUpload): Promise<StoredSourceMap> {
      const name = assertSourceMapName(upload.name)
      const shape = assertSourceMapBody(upload.body)
      const key = sourceMapKey(upload.projectId, upload.releaseId, name)

      const before = await listing(upload.projectId, upload.releaseId)
      if (!before.includes(name) && before.length >= MAX_SOURCE_MAPS_PER_RELEASE) {
        throw new InvalidSourceMap(
          'name',
          `This release already holds ${MAX_SOURCE_MAPS_PER_RELEASE} source maps.`,
        )
      }

      await blobs.put(key, upload.body, SOURCE_MAP_CONTENT_TYPE)

      return {
        key,
        name,
        bytes: shape.bytes,
        total: before.includes(name) ? before.length : before.length + 1,
      }
    },
  }
}
