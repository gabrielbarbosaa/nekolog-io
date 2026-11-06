import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { cn, FONT_SIZES } from './utils'

const STYLESHEET = fileURLToPath(new URL('../app/globals.css', import.meta.url))

describe('a size class and a colour class survive each other', () => {
  it.each(FONT_SIZES)('keeps text-%s next to a colour', (size) => {
    expect(cn(`text-${size}`, 'text-muted-foreground')).toBe(`text-${size} text-muted-foreground`)
    expect(cn('text-muted-foreground', `text-${size}`)).toBe(`text-muted-foreground text-${size}`)
  })

  it('still collapses two sizes, which is what the merge is for', () => {
    expect(cn('text-data', 'text-screen')).toBe('text-screen')
  })

  it('still collapses two colours', () => {
    expect(cn('text-muted-foreground', 'text-foreground')).toBe('text-foreground')
  })
})

describe('the sizes the stylesheet actually defines', () => {
  const css = readFileSync(STYLESHEET, 'utf8')

  it('declares every size the merge is told about', () => {
    for (const size of FONT_SIZES) {
      expect(css, `--text-${size} is not in globals.css`).toContain(`--text-${size}:`)
    }
  })

  it('tells the merge about every size the stylesheet declares', () => {
    const declared = [...css.matchAll(/^ {2}--text-([a-z]+):/gm)].map((match) => match[1] as string)

    expect(declared.length).toBeGreaterThan(0)
    expect([...declared].sort()).toEqual([...FONT_SIZES].sort())
  })
})
