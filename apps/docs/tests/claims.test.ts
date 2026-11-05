import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DOCS_DIR = fileURLToPath(new URL('../src/content/docs/', import.meta.url))
const PAGE_EXTENSIONS = ['.md', '.mdx']

const OPEN = /\bMIT\b|open[- ]source|open[- ]core|c[óo]digo aberto|self[- ]host/i
const REPOSITORY = /github\.com\/gabrielbarbosaa/i

async function listPages(): Promise<string[]> {
  const entries = await readdir(DOCS_DIR, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && PAGE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)))
    .map((entry) => {
      const dir = entry.parentPath.slice(DOCS_DIR.length).replaceAll('\\', '/')
      return dir ? `${dir}/${entry.name}` : entry.name
    })
}

async function pagesMatching(pattern: RegExp): Promise<string[]> {
  const offending: string[] = []
  for (const page of await listPages()) {
    const body = await readFile(`${DOCS_DIR}${page}`, 'utf8')
    for (const line of body.split('\n')) {
      if (pattern.test(line)) {
        offending.push(`${page}: ${line.trim()}`)
      }
    }
  }
  return offending
}

describe('what the documentation promises a reader', () => {
  it('covers enough pages for this to mean anything', async () => {
    expect((await listPages()).length).toBeGreaterThan(60)
  })

  it('never calls the product open source, open core or MIT, in any language', async () => {
    expect(await pagesMatching(OPEN)).toEqual([])
  })

  it('never sends a reader to a repository they cannot open', async () => {
    expect(await pagesMatching(REPOSITORY)).toEqual([])
  })
})

describe('the detector itself', () => {
  it('separates a claim of openness from its absence', () => {
    expect(OPEN.test('The SDKs are open source under MIT.')).toBe(true)
    expect(OPEN.test('Este projeto tem código aberto.')).toBe(true)
    expect(OPEN.test('Puedes alojarlo con el self-host.')).toBe(true)
    expect(OPEN.test('NekoLog is proprietary software.')).toBe(false)
    expect(OPEN.test('It batches logs and sends them over HTTPS.')).toBe(false)
  })

  it('separates our repository from any other link', () => {
    expect(REPOSITORY.test('see https://github.com/gabrielbarbosaa/nekolog-io')).toBe(true)
    expect(REPOSITORY.test('see https://github.com/pinojs/pino')).toBe(false)
  })
})
