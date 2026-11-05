import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const PRESENT = ['README.md', 'LICENSE', 'SECURITY.md', 'LICENSES/MIT-historical.txt']
const GONE = ['README.pt-BR.md', 'README.es.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md']

const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g
const OPEN = /\bMIT\b|open[- ]source|open[- ]core/i

function read(file: string): string {
  return readFileSync(join(ROOT, file), 'utf8')
}

function relativeLinksIn(text: string): string[] {
  return [...text.matchAll(LINK)]
    .map((match) => match[1] as string)
    .filter((target) => !/^(https?:|mailto:|#)/.test(target))
    .map((target) => target.split('#')[0] as string)
    .filter((target) => target !== '')
}

describe('the files at the root', () => {
  it('are the ones a private repository keeps', () => {
    for (const file of PRESENT) {
      expect(existsSync(join(ROOT, file)), `${file} is missing`).toBe(true)
    }
  })

  it('no longer carry what only a public project needs', () => {
    for (const file of GONE) {
      expect(existsSync(join(ROOT, file)), `${file} came back`).toBe(false)
    }
  })

  it('link only to paths that exist in this repository', () => {
    const broken: string[] = []

    for (const [file, atLeast] of [
      ['README.md', 10],
      ['SECURITY.md', 1],
    ] as const) {
      const links = relativeLinksIn(read(file))
      expect(
        links.length,
        `${file} has too few relative links for this to prove anything`,
      ).toBeGreaterThanOrEqual(atLeast)
      for (const target of links) {
        if (!existsSync(join(ROOT, target))) {
          broken.push(`${file} -> ${target}`)
        }
      }
    }

    expect(broken).toEqual([])
  })
})

describe('what the root says about the licence', () => {
  it('never calls the project MIT, open source or open core', () => {
    const claiming = ['README.md', 'SECURITY.md'].filter((file) => OPEN.test(read(file)))

    expect(claiming).toEqual([])
  })

  it('separates the MIT record from the licence in force', () => {
    const historical = read('LICENSES/MIT-historical.txt')

    expect(historical).toMatch(OPEN)
    expect(historical).toContain('NOT the licence of this repository today')
    expect(read('LICENSE')).toContain('All rights reserved')
  })

  it('keeps the one grant without which nothing can be sold', () => {
    const licence = read('LICENSE')
    const flowing = licence.toLowerCase().replace(/\s+/g, ' ')

    expect(licence).toContain('GRANT FOR THE SDK PACKAGES')
    expect(flowing).toContain('as an incorporated component of your application')
    expect(flowing).toContain('install and use the sdk packages')
  })

  it('sends the reader from the README to the licence itself', () => {
    expect(relativeLinksIn(read('README.md'))).toContain('LICENSE')
  })
})

describe('the detector itself', () => {
  it('separates a claim of openness from its absence', () => {
    expect(OPEN.test('Licensed under the MIT licence.')).toBe(true)
    expect(OPEN.test('This is an open-source project.')).toBe(true)
    expect(OPEN.test('open core, with the dashboard closed')).toBe(true)
    expect(OPEN.test('Private and proprietary. All rights reserved.')).toBe(false)
    expect(OPEN.test('It transmits data over HTTPS.')).toBe(false)
  })
})
