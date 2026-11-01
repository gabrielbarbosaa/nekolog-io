import type { BlobStore } from '../blob-store.ts'

export type R2ObjectBodyLike = {
  arrayBuffer: () => Promise<ArrayBuffer>
}

export type R2ListedLike = {
  objects: ReadonlyArray<{ key: string }>
  truncated: boolean
  cursor?: string
}

export type R2BucketLike = {
  put: (
    key: string,
    body: Uint8Array | string,
    options?: { httpMetadata?: { contentType?: string } },
  ) => Promise<unknown>
  get: (key: string) => Promise<R2ObjectBodyLike | null>
  delete: (key: string) => Promise<void>
  list: (options: { prefix: string; limit?: number; cursor?: string }) => Promise<R2ListedLike>
}

export const R2_LIST_PAGE = 1000

export function r2BlobStore(bucket: R2BucketLike): BlobStore {
  return {
    async put(key, body, contentType) {
      await bucket.put(
        key,
        body,
        contentType === undefined ? undefined : { httpMetadata: { contentType } },
      )
    },

    async get(key) {
      const object = await bucket.get(key)
      return object === null ? null : new Uint8Array(await object.arrayBuffer())
    },

    async delete(key) {
      await bucket.delete(key)
    },

    async list(prefix, limit) {
      if (limit !== undefined && limit <= 0) {
        return []
      }

      const keys: string[] = []
      let cursor: string | undefined

      do {
        const page = await bucket.list({
          prefix,
          limit:
            limit === undefined
              ? R2_LIST_PAGE
              : Math.min(R2_LIST_PAGE, Math.max(0, limit - keys.length)),
          ...(cursor === undefined ? {} : { cursor }),
        })

        for (const object of page.objects) {
          keys.push(object.key)
        }

        if (limit !== undefined && keys.length >= limit) {
          return keys.slice(0, limit)
        }
        cursor = page.truncated && page.objects.length > 0 ? page.cursor : undefined
      } while (cursor !== undefined)

      return keys
    },
  }
}
