import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { KvNamespace } from '@nekolog-io/adapters'
import { kvFileName } from './keys.ts'

export const TEMPORARY_PREFIX = '.writing-'

function missing(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'ENOENT'
}

export function fileKvNamespace(folder: string): KvNamespace {
  return {
    async get(key, type) {
      if (type !== 'text') {
        throw new Error(`The file KV only reads text, it was asked for ${JSON.stringify(type)}`)
      }
      try {
        return await readFile(join(folder, kvFileName(key)), 'utf8')
      } catch (error) {
        if (missing(error)) {
          return null
        }
        throw error
      }
    },

    async put(key, value) {
      const target = join(folder, kvFileName(key))
      await mkdir(folder, { recursive: true })

      const temporary = join(folder, `${TEMPORARY_PREFIX}${randomBytes(12).toString('hex')}`)
      await writeFile(temporary, value, 'utf8')
      try {
        await rename(temporary, target)
      } catch (error) {
        await rm(temporary, { force: true })
        throw error
      }
    },

    async delete(key) {
      await rm(join(folder, kvFileName(key)), { force: true })
    },
  }
}
