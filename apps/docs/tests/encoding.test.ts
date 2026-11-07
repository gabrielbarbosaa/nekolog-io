import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DOCS_DIR = fileURLToPath(new URL('../src/content/docs/', import.meta.url))
const PAGE_EXTENSIONS = ['.md', '.mdx']

const BYTE_ORDER_MARK = '﻿'

const DOUBLE_ENCODED = /Ã[\u0080-\u00bf]|â€[\u0080-\u009f“”™]|Â[\u0080-\u00bf]/

async function listPages(): Promise<string[]> {
  const entries = await readdir(DOCS_DIR, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && PAGE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)))
    .map((entry) => {
      const dir = entry.parentPath.slice(DOCS_DIR.length).replaceAll('\\', '/')
      return dir ? `${dir}/${entry.name}` : entry.name
    })
}

describe('how the pages are written to disk', () => {
  it('writes no byte order mark, which a Markdown parser reads as content', async () => {
    const pages = await listPages()

    for (const page of pages) {
      const text = await readFile(`${DOCS_DIR}${page}`, 'utf8')
      expect(text.startsWith(BYTE_ORDER_MARK), `${page} starts with a byte order mark`).toBe(false)
    }
  })

  it('carries no text that was encoded twice', async () => {
    const pages = await listPages()
    const broken: string[] = []

    for (const page of pages) {
      const text = await readFile(`${DOCS_DIR}${page}`, 'utf8')
      const found = DOUBLE_ENCODED.exec(text)
      if (found !== null) {
        broken.push(
          `${page}: ${JSON.stringify(text.slice(Math.max(0, found.index - 20), found.index + 20))}`,
        )
      }
    }

    expect(broken).toEqual([])
  })

  it('notices the shape of the corruption it is looking for', () => {
    const correct = 'cambiar — las promesas, todavía, están'
    const twice = Buffer.from(correct, 'utf8').toString('latin1')

    expect(DOUBLE_ENCODED.test(correct)).toBe(false)
    expect(DOUBLE_ENCODED.test(twice)).toBe(true)
  })
})
