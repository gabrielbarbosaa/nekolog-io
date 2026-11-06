import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const CANONICAL = join(ROOT, 'docs', 'tema', 'globals.css')

const COPIES = [
  join(ROOT, 'apps', 'web', 'app', 'globals.css'),
  join(ROOT, 'apps', 'dashboard', 'app', 'globals.css'),
  join(ROOT, 'docs', 'ui-mockups', 'tokens.css'),
]

const LIGHT = /:root \{[\s\S]*?\n\}/
const DARK = /\.dark \{[\s\S]*?\n\}/

function read(file: string): string {
  return readFileSync(file, 'utf8')
}

function blocksIn(text: string, file: string): { light: string; dark: string } {
  const light = LIGHT.exec(text)?.[0]
  const dark = DARK.exec(text)?.[0]

  expect(light, `${file} declares no :root block`).toBeDefined()
  expect(dark, `${file} declares no .dark block`).toBeDefined()

  return { light: light as string, dark: dark as string }
}

describe('the Grafite theme has one source', () => {
  const canonical = read(CANONICAL)
  const expected = blocksIn(canonical, CANONICAL)

  it('found tokens to compare, so this is not passing on an empty match', () => {
    expect(expected.light).toContain('--level-fatal')
    expect(expected.dark).toContain('--level-fatal')
    expect(expected.light.split('\n').length).toBeGreaterThan(40)
  })

  it.each(COPIES)('keeps %s identical to docs/tema/globals.css', (file) => {
    const copy = blocksIn(read(file), file)

    expect(copy.light, `${file} drifted from the canonical :root`).toBe(expected.light)
    expect(copy.dark, `${file} drifted from the canonical .dark`).toBe(expected.dark)
  })

  it('carries the hex annotations, which are the only record of the original palette', () => {
    for (const file of COPIES) {
      expect(read(file), `${file} lost the hex annotations`).toMatch(/\/\* #[0-9a-f]{6} \*\//)
    }
  })
})
