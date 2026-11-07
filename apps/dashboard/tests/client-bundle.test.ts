import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = fileURLToPath(new URL('../', import.meta.url))
const SKIP = new Set(['node_modules', '.next', '.turbo', 'test-results'])

const SERVER_ONLY = ['@internal/auth', '@nekolog-io/adapters', 'postgres', 'ioredis', 'nodemailer']

function componentsUnder(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    if (SKIP.has(entry)) {
      continue
    }
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      found.push(...componentsUnder(path))
    } else if (entry.endsWith('.tsx')) {
      found.push(path)
    }
  }
  return found
}

const FILES = [join(HERE, 'app'), join(HERE, 'components')].flatMap(componentsUnder)

const CLIENT = FILES.filter((path) => readFileSync(path, 'utf8').startsWith("'use client'")).map(
  (path) => ({
    name: relative(HERE, path).split(sep).join('/'),
    source: readFileSync(path, 'utf8'),
  }),
)

function valueImports(source: string): string[] {
  return [...source.matchAll(/^import\s+(?!type\s)([\s\S]*?)from\s+'([^']+)'/gm)]
    .filter((match) => !/^\{\s*type\s/.test((match[1] as string).trim()))
    .map((match) => match[2] as string)
}

describe('what a client component is allowed to pull into the browser', () => {
  it('found the client components, so none of this is passing on an empty list', () => {
    expect(CLIENT.length).toBeGreaterThanOrEqual(8)
    expect(CLIENT.map((one) => one.name)).toContain('components/environment-card.tsx')
  })

  it.each(CLIENT)('$name imports nothing that belongs on the server', ({ source, name }) => {
    const reached = valueImports(source).filter((one) =>
      SERVER_ONLY.some((banned) => one === banned || one.startsWith(`${banned}/`)),
    )

    expect(
      reached,
      `${name} would carry ${reached.join(', ')} into the browser bundle — argon2 among them. ` +
        'Pass the value down from the server component instead, or use `import type`.',
    ).toEqual([])
  })

  it('reads a type-only import as the nothing it compiles to', () => {
    expect(valueImports("import type { Environment } from '@internal/auth'\n")).toEqual([])
    expect(valueImports("import { type Level } from '@internal/auth'\n")).toEqual([])
    expect(valueImports("import { LEVELS } from '@internal/auth'\n")).toEqual(['@internal/auth'])
  })
})
