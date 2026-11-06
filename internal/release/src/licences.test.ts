import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  countOf,
  isDenied,
  type Listing,
  MINIMUM_PACKAGES,
  parseListing,
  refusalsIn,
  refuses,
  termsOf,
} from './licences.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const DENIED_BY_THE_WORKFLOW_THAT_IS_GONE = [
  'GPL-2.0-only',
  'GPL-2.0-or-later',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
]

function listingOf(entries: Listing): Listing {
  const padding: Listing = {
    MIT: Array.from({ length: MINIMUM_PACKAGES }, (_, index) => ({
      name: `filler-${index}`,
      versions: ['1.0.0'],
    })),
  }

  return { ...padding, ...entries }
}

describe('what the licence policy still refuses', () => {
  it('refuses everything the dependency-review workflow refused', () => {
    for (const identifier of DENIED_BY_THE_WORKFLOW_THAT_IS_GONE) {
      expect(refuses(identifier), identifier).toBe(true)
    }
  })

  it('refuses the spellings that list had no entry for', () => {
    for (const identifier of ['GPL-3.0', 'GPL-2.0+', 'AGPL-3.0', 'GPL']) {
      expect(refuses(identifier), identifier).toBe(true)
    }
  })

  it('reads the licence before a WITH exception, which is the licence', () => {
    expect(refuses('GPL-2.0-only WITH Classpath-exception-2.0')).toBe(true)
    expect(refuses('MIT WITH GPL-3.0-only')).toBe(false)
  })

  it('does not mistake the lesser licence for the one it is not', () => {
    for (const identifier of [
      'LGPL-3.0-or-later',
      'LGPL-2.1',
      'GNU Lesser General Public License',
    ]) {
      expect(isDenied(identifier), identifier).toBe(false)
    }
  })

  it('catches the licence written out in words, because a manifest may say it that way', () => {
    expect(refuses('GNU General Public License v3')).toBe(true)
    expect(refuses('GNU Affero General Public License')).toBe(true)
  })

  it('leaves free text that is nobody we refuse alone', () => {
    for (const identifier of ['SIL OPEN FONT LICENSE', 'Python-2.0', 'CC-BY-4.0', 'Unlicense']) {
      expect(refuses(identifier), identifier).toBe(false)
    }
  })
})

describe('how an expression of more than one licence is read', () => {
  it('lets a choice through when one of the alternatives is ours to take', () => {
    expect(refuses('MIT OR GPL-3.0-only')).toBe(false)
    expect(refuses('(MIT OR Apache-2.0)')).toBe(false)
  })

  it('refuses a choice in which every alternative is refused', () => {
    expect(refuses('GPL-2.0-only OR GPL-3.0-only')).toBe(true)
  })

  it('refuses a conjunction when either half is refused, because both apply', () => {
    expect(refuses('MIT AND GPL-3.0-only')).toBe(true)
    expect(refuses('Apache-2.0 AND LGPL-3.0-or-later')).toBe(false)
  })

  it('binds AND tighter than OR, which is what the expression means', () => {
    expect(termsOf('MIT AND GPL-3.0-only OR Apache-2.0')).toEqual([
      ['MIT', 'GPL-3.0-only'],
      ['Apache-2.0'],
    ])
    expect(refuses('MIT AND GPL-3.0-only OR Apache-2.0')).toBe(false)
  })
})

describe('reading the listing pnpm prints', () => {
  it('names every package carrying a refused licence, and nothing else', () => {
    const refusals = refusalsIn(
      listingOf({
        'GPL-3.0-only': [{ name: 'copylefted', versions: ['2.0.0'] }],
        'MIT OR GPL-2.0-only': [{ name: 'dual', versions: ['1.0.0'] }],
        'AGPL-3.0-or-later': [{ name: 'affero', versions: ['3.0.0', '3.1.0'] }],
      }),
    )

    expect(refusals.map((refusal) => refusal.name)).toEqual(['affero', 'copylefted'])
    expect(refusals[0]?.versions).toEqual(['3.0.0', '3.1.0'])
  })

  it('refuses a listing small enough to be one project instead of the workspace', () => {
    expect(() =>
      parseListing(JSON.stringify({ MIT: [{ name: 'alone', versions: ['1.0.0'] }] })),
    ).toThrow(/not the whole workspace/)
  })

  it('survives the byte order mark a Windows pipe puts in front', () => {
    const text = `﻿${JSON.stringify(listingOf({}))}`

    expect(countOf(parseListing(text))).toBe(MINIMUM_PACKAGES)
  })

  it('refuses a shape it does not recognise rather than reporting nothing wrong', () => {
    expect(() => parseListing('[]')).toThrow(/not an object/)
    expect(() => parseListing(JSON.stringify({ MIT: 'all of them' }))).toThrow(/no array/)
    expect(() => parseListing(JSON.stringify({ MIT: [{ versions: [] }] }))).toThrow(/nameless/)
  })
})

describe('what runs the check', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }

  it('asks pnpm for every project, not only the one at the root', () => {
    expect(manifest.scripts['licences:check']).toContain('-r licenses list --json')
  })

  it('pipes into the command instead of spawning a pnpm shim no Windows can spawn', () => {
    expect(manifest.scripts['licences:check']).toContain(
      '| node internal/release/src/licences-cli.ts',
    )
  })
})
