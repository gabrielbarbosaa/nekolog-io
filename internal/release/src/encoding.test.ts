import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const WORKSPACES = ['apps', 'internal', 'packages', 'examples', 'docs', 'deploy', 'infra']
const SKIP = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  '.astro',
  'coverage',
  '.git',
  'test-results',
])
const WATCHED = ['.ts', '.tsx', '.mjs', '.js', '.json', '.md', '.yml', '.yaml', '.css', '.sql']

const BYTE_ORDER_MARK = 0xfeff
const DOUBLE_ENCODED = /Ã[\u0080-¿]|â€[\u0080-\u009f“”™]|Â[\u0080-¿]/

function filesUnder(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    if (SKIP.has(entry)) {
      continue
    }
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      found.push(...filesUnder(path))
    } else if (WATCHED.some((extension) => entry.endsWith(extension))) {
      found.push(path)
    }
  }
  return found
}

const FILES = [
  ...WORKSPACES.filter((workspace) => existsSync(join(ROOT, workspace))).flatMap((workspace) =>
    filesUnder(join(ROOT, workspace)),
  ),
  ...['README.md', 'CLAUDE.md', 'SECURITY.md', 'package.json', 'turbo.json', '.env.example']
    .map((name) => join(ROOT, name))
    .filter((path) => existsSync(path)),
]

function named(path: string): string {
  return relative(ROOT, path).split(sep).join('/')
}

const HOLDS_THE_PATTERN = ['CLAUDE.md']

function holdsThePatternOnPurpose(path: string): boolean {
  return HOLDS_THE_PATTERN.includes(named(path))
}

describe('how this repository is written to disk', () => {
  it('found enough files for this check to mean anything', () => {
    expect(FILES.length).toBeGreaterThan(500)
    expect(FILES.map(named)).toContain('.env.example')
  })

  it('carries no byte order mark, which a parser reads as content', () => {
    const marked = FILES.filter(
      (path) => readFileSync(path, 'utf8').charCodeAt(0) === BYTE_ORDER_MARK,
    )

    expect(marked.map(named)).toEqual([])
  })

  it('carries no text that was encoded twice', () => {
    const broken: string[] = []

    for (const path of FILES.filter((one) => !holdsThePatternOnPurpose(one))) {
      const text = readFileSync(path, 'utf8')
      const found = DOUBLE_ENCODED.exec(text)
      if (found !== null) {
        broken.push(
          `${named(path)}: ${JSON.stringify(
            text.slice(Math.max(0, found.index - 24), found.index + 24),
          )}`,
        )
      }
    }

    expect(
      broken,
      'on Windows this is what `Set-Content` does to a UTF-8 file; write it with the editor instead',
    ).toEqual([])
  })

  it('leaves out only files that carry the pattern on purpose, and all of them exist', () => {
    for (const name of HOLDS_THE_PATTERN) {
      const text = readFileSync(join(ROOT, name), 'utf8')
      expect(DOUBLE_ENCODED.test(text), `${name} no longer needs an exception`).toBe(true)
    }
  })

  it('leaves a capital with a circumflex alone, which Portuguese spells words with', () => {
    for (const word of ['Âmbar', 'Ângela', 'Ônibus', 'Única', 'Égua']) {
      expect(DOUBLE_ENCODED.test(word), `${word} is a word, not corruption`).toBe(false)
    }
    const misread = Buffer.from([0xc2, 0xa0]).toString('latin1')
    expect(DOUBLE_ENCODED.test(misread), 'those same two bytes read as cp1252 are not').toBe(true)
  })

  it('notices the shape of the corruption it is looking for', () => {
    const correct = 'a ingestão relê o arquivo sozinha — não é opção'
    const twice = Buffer.from(correct, 'utf8').toString('latin1')

    expect(DOUBLE_ENCODED.test(correct)).toBe(false)
    expect(DOUBLE_ENCODED.test(twice)).toBe(true)
  })
})
