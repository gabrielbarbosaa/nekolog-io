import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DOCS_DIR = fileURLToPath(new URL('../src/content/docs/', import.meta.url))
const TYPES_FILE = fileURLToPath(new URL('../../../packages/core/src/types.ts', import.meta.url))
const PAGE_EXTENSIONS = ['.md', '.mdx']

const CALL = /(?<![.\w])createLogger\(\{/g

async function listPages(): Promise<string[]> {
  const entries = await readdir(DOCS_DIR, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && PAGE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)))
    .map((entry) => {
      const dir = entry.parentPath.slice(DOCS_DIR.length).replaceAll('\\', '/')
      return dir ? `${dir}/${entry.name}` : entry.name
    })
}

function literalAt(text: string, open: number): string {
  let depth = 0
  for (let at = open; at < text.length; at += 1) {
    const character = text[at]
    if (character === '{') {
      depth += 1
    } else if (character === '}') {
      depth -= 1
      if (depth === 0) {
        return text.slice(open + 1, at)
      }
    }
  }
  throw new Error('a createLogger call is never closed')
}

function keysOf(literal: string): string[] {
  const keys: string[] = []
  let depth = 0
  for (const line of literal.split('\n')) {
    const found = depth === 0 ? /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(line) : null
    if (found?.[1] !== undefined) {
      keys.push(found[1])
    }
    for (const character of line) {
      if (character === '{' || character === '[' || character === '(') depth += 1
      if (character === '}' || character === ']' || character === ')') depth -= 1
    }
  }
  return keys
}

function inlineKeysOf(literal: string): string[] {
  return literal.includes('\n')
    ? keysOf(literal)
    : [...literal.matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*:/g)].map((match) => match[1] as string)
}

function optionNamesIn(source: string): string[] {
  const start = source.indexOf('export type LoggerOptions = {')
  if (start === -1) {
    throw new Error('LoggerOptions is not declared where this test looks for it')
  }
  const body = literalAt(source, source.indexOf('{', start))
  return [...body.matchAll(/^\s*([A-Za-z_$][\w$]*)\??:/gm)].map((match) => match[1] as string)
}

describe('the code samples in the documentation', () => {
  it('passes createLogger only options it actually takes', async () => {
    const allowed = optionNamesIn(await readFile(TYPES_FILE, 'utf8'))
    const unknown: string[] = []
    let calls = 0

    for (const page of await listPages()) {
      const text = await readFile(`${DOCS_DIR}${page}`, 'utf8')
      for (const match of text.matchAll(CALL)) {
        calls += 1
        const literal = literalAt(text, (match.index ?? 0) + match[0].length - 1)
        for (const key of inlineKeysOf(literal)) {
          if (!allowed.includes(key)) {
            unknown.push(`${page}: ${key}`)
          }
        }
      }
    }

    expect(calls, 'no createLogger sample was found, so this test proved nothing').toBeGreaterThan(
      10,
    )
    expect(unknown).toEqual([])
  })

  it('reads the options from the type, not from a second list', async () => {
    const allowed = optionNamesIn(await readFile(TYPES_FILE, 'utf8'))

    expect(allowed).toContain('apiKey')
    expect(allowed).toContain('service')
    expect(allowed).toContain('release')
    expect(allowed).not.toContain('key')
    expect(allowed).not.toContain('endpoint')
  })

  it('does not mistake another library’s createLogger for ours', () => {
    expect([...'winston.createLogger({ transports: [] })'.matchAll(CALL)]).toEqual([])
    expect([...'createLogger({ service: ‘a’ })'.matchAll(CALL)]).toHaveLength(1)
  })

  it('reads the keys of a call written over several lines', () => {
    const literal = literalAt('createLogger({\n  apiKey: k,\n  transport: { endpoint: e },\n})', 13)

    expect(keysOf(literal)).toEqual(['apiKey', 'transport'])
  })
})
