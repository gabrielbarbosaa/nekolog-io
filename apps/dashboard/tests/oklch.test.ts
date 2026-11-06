import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { asPaintable, oklchToHex, parseOklch, withAlpha } from '../lib/oklch'

const CSS = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8')

const RECORDED = /--([a-z0-9-]+):\s*(oklch\([^)]+\));\s*\/\* (#[0-9a-f]{6}) \*\//g

type Pair = { token: string; oklch: string; hex: string }

const PAIRS: Pair[] = [...CSS.matchAll(RECORDED)].map((found) => ({
  token: found[1] as string,
  oklch: found[2] as string,
  hex: found[3] as string,
}))

function apart(left: string, right: string): number {
  const read = (hex: string) =>
    [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [number, number, number]
  const [r1, g1, b1] = read(left)
  const [r2, g2, b2] = read(right)

  return Math.max(Math.abs(r1 - r2), Math.abs(g1 - g2), Math.abs(b1 - b2))
}

describe('turning a theme token into a colour a canvas can paint', () => {
  it('found the recorded palette, so none of this is passing on an empty list', () => {
    expect(PAIRS.length).toBeGreaterThan(50)
  })

  it.each(PAIRS)('$token lands on the hex the stylesheet records', ({ oklch, hex }) => {
    const converted = oklchToHex(oklch)

    expect(converted).toBeDefined()
    expect(
      apart(converted as string, hex),
      `${oklch} became ${converted}, and the stylesheet records ${hex}`,
    ).toBeLessThanOrEqual(2)
  })

  it('takes the two ends exactly', () => {
    expect(oklchToHex('oklch(1 0 0)')).toBe('#ffffff')
    expect(oklchToHex('oklch(0 0 0)')).toBe('#000000')
  })

  it('reads a percentage the way CSS does', () => {
    expect(parseOklch('oklch(100% 0 0)')).toEqual({ l: 1, c: 0, h: 0 })
    expect(oklchToHex('oklch(100% 0 0)')).toBe('#ffffff')
  })

  it('clamps a colour outside the screen rather than wrapping it', () => {
    const vivid = oklchToHex('oklch(0.7 0.4 150)')

    expect(vivid).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('says it does not know rather than guessing', () => {
    expect(oklchToHex('#ff0000')).toBeUndefined()
    expect(oklchToHex('rgb(1 2 3)')).toBeUndefined()
    expect(oklchToHex('oklch(nonsense)')).toBeUndefined()
  })

  it('hands back whatever it was given when it cannot convert, so nothing goes blank', () => {
    expect(asPaintable('#ff0000')).toBe('#ff0000')
    expect(asPaintable(' oklch(1 0 0) ')).toBe('#ffffff')
  })

  it('adds an alpha channel only to a hex it recognises', () => {
    expect(withAlpha('#2a78d6', 0.2)).toBe('#2a78d633')
    expect(withAlpha('#2a78d6', 1)).toBe('#2a78d6ff')
    expect(withAlpha('oklch(1 0 0)', 0.5)).toBe('oklch(1 0 0)')
  })
})
