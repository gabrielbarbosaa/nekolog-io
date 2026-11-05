import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const SKIP = new Set([
  '.git',
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  '.astro',
  '.vercel',
  'coverage',
  'sbom',
])

const PARSED = new Set(['.json', '.yml', '.yaml', '.toml', '.xml'])

const BOM = '﻿'

function configFiles(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    if (SKIP.has(entry)) {
      continue
    }
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      found.push(...configFiles(path))
    } else if (PARSED.has(entry.slice(entry.lastIndexOf('.')))) {
      found.push(path)
    }
  }
  return found
}

const FILES = configFiles(ROOT)

describe('a configuration file a tool parses strictly', () => {
  it('was found in enough places for this check to mean anything', () => {
    expect(FILES.length).toBeGreaterThan(50)
  })

  it('carries no byte order mark, which a PowerShell redirect adds and no parser wants', () => {
    const marked = FILES.filter((file) => readFileSync(file, 'utf8').startsWith(BOM)).map((file) =>
      relative(ROOT, file),
    )

    expect(marked).toEqual([])
  })

  it('would notice one, which is the only way to know this test can fail', () => {
    expect(`${BOM}{}`.startsWith(BOM)).toBe(true)
    expect('{}'.startsWith(BOM)).toBe(false)
    expect(Buffer.from(BOM, 'utf8')).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
  })
})
