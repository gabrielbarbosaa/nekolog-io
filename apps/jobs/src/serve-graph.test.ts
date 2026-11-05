import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = dirname(fileURLToPath(import.meta.url))

const IMPORT = /(?:^|\n)\s*(?:import|export)\b[\s\S]*?from\s*['"]([^'"]+)['"]/g
const SIDE_EFFECT = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g

const FORBIDDEN_IN_THE_JOBS_CONTAINER = ['@internal/backup']

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  return [...text.matchAll(IMPORT), ...text.matchAll(SIDE_EFFECT)].map(
    (match) => match[1] as string,
  )
}

function graphFrom(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>()
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) {
      continue
    }
    const specifiers = importsOf(file)
    seen.set(file, specifiers)

    for (const specifier of specifiers) {
      if (!specifier.startsWith('.')) {
        continue
      }
      const next = resolve(dirname(file), specifier)
      if (existsSync(next)) {
        queue.push(next)
      }
    }
  }
  return seen
}

describe('what the jobs container drags in', () => {
  const graph = graphFrom(join(SRC, 'serve.ts'))

  it('reaches enough files for this check to mean anything', () => {
    expect(graph.size).toBeGreaterThan(10)
  })

  it('never reaches the backup, which lives in a container with its own binaries', () => {
    const offending: string[] = []
    for (const [file, specifiers] of graph) {
      for (const specifier of specifiers) {
        if (FORBIDDEN_IN_THE_JOBS_CONTAINER.includes(specifier)) {
          offending.push(`${relative(SRC, file)} imports ${specifier}`)
        }
      }
    }

    expect(offending).toEqual([])
  })

  it('does not reach the backup entry point either', () => {
    expect([...graph.keys()].map((file) => relative(SRC, file))).not.toContain('backup.ts')
  })

  it('would notice, which is the only way to know this test can fail', () => {
    const fromBackup = graphFrom(join(SRC, 'backup.ts'))
    const specifiers = [...fromBackup.values()].flat()

    expect(specifiers).toContain('@internal/backup')
  })
})
