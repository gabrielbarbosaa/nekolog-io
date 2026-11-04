import { randomBytes } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { BlobStore } from '@nekolog-io/adapters'
import { blobKeySegments } from './keys.ts'

export const TEMPORARY_PREFIX = '.writing-'

function missing(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'ENOENT'
}

function bytesOf(body: Uint8Array | string): Uint8Array {
  return typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body)
}

async function keysUnder(root: string, prefix: readonly string[]): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(join(root, ...prefix), { withFileTypes: true })
  } catch (error) {
    if (missing(error)) {
      return []
    }
    throw error
  }

  const keys: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue
    }
    const here = [...prefix, entry.name]
    if (entry.isDirectory()) {
      keys.push(...(await keysUnder(root, here)))
    } else if (entry.isFile()) {
      keys.push(here.join('/'))
    }
  }
  return keys
}

export function fileBlobStore(root: string): BlobStore {
  function pathFor(key: string): string {
    return join(root, ...blobKeySegments(key))
  }

  return {
    async put(key, body) {
      const target = pathFor(key)
      const folder = dirname(target)
      await mkdir(folder, { recursive: true })

      const temporary = join(folder, `${TEMPORARY_PREFIX}${randomBytes(12).toString('hex')}`)
      await writeFile(temporary, bytesOf(body))
      try {
        await rename(temporary, target)
      } catch (error) {
        await rm(temporary, { force: true })
        throw error
      }
    },

    async get(key) {
      try {
        return new Uint8Array(await readFile(pathFor(key)))
      } catch (error) {
        if (missing(error)) {
          return null
        }
        throw error
      }
    },

    async delete(key) {
      await rm(pathFor(key), { force: true })
    },

    async list(prefix, limit) {
      if (limit !== undefined && limit <= 0) {
        return []
      }
      const keys = (await keysUnder(root, [])).filter((key) => key.startsWith(prefix)).sort()
      return limit === undefined ? keys : keys.slice(0, limit)
    },
  }
}
