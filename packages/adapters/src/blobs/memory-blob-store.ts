import type { BlobStore } from '../blob-store.ts'

export type MemoryBlobStore = BlobStore & {
  readonly size: number
  clear(): void
}

type TextEncoderLike = { encode(input: string): Uint8Array }

function asBytes(body: Uint8Array | string): Uint8Array {
  if (typeof body !== 'string') {
    return new Uint8Array(body)
  }
  const Encoder = (globalThis as { TextEncoder?: new () => TextEncoderLike }).TextEncoder
  if (Encoder === undefined) {
    throw new Error('This runtime has no TextEncoder, so it cannot store a string')
  }
  return new Encoder().encode(body)
}

export function memoryBlobStore(
  initial: Record<string, Uint8Array | string> = {},
): MemoryBlobStore {
  const blobs = new Map<string, Uint8Array>(
    Object.entries(initial).map(([key, body]) => [key, asBytes(body)]),
  )

  return {
    get size() {
      return blobs.size
    },
    async put(key, body) {
      blobs.set(key, asBytes(body))
    },
    async get(key) {
      const found = blobs.get(key)
      return found === undefined ? null : new Uint8Array(found)
    },
    async delete(key) {
      blobs.delete(key)
    },
    async list(prefix, limit) {
      const keys = [...blobs.keys()].filter((key) => key.startsWith(prefix)).sort()
      return limit === undefined ? keys : keys.slice(0, Math.max(0, limit))
    },
    clear() {
      blobs.clear()
    },
  }
}
