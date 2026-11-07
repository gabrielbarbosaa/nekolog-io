import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { OVERSCAN, ROW_HEIGHT, reachedTheEnd, windowFor } from '../lib/virtual'

const TABLE = readFileSync(
  fileURLToPath(new URL('../components/log-table.tsx', import.meta.url)),
  'utf8',
)

describe('the window a scrolled table actually draws', () => {
  it('draws nothing when there is nothing', () => {
    expect(windowFor({ scrollTop: 0, viewport: 600, count: 0 })).toEqual({
      first: 0,
      last: -1,
      above: 0,
      below: 0,
    })
  })

  it('starts at the top with the overscan ahead of it', () => {
    const shown = windowFor({ scrollTop: 0, viewport: 600, count: 1000 })

    expect(shown.first).toBe(0)
    expect(shown.last).toBe(Math.ceil(600 / ROW_HEIGHT) - 1 + OVERSCAN)
  })

  it('moves with the scroll and keeps the overscan behind it', () => {
    const shown = windowFor({ scrollTop: 100 * ROW_HEIGHT, viewport: 600, count: 1000 })

    expect(shown.first).toBe(100 - OVERSCAN)
    expect(shown.above).toBe((100 - OVERSCAN) * ROW_HEIGHT)
  })

  it('never reaches past the last row', () => {
    const shown = windowFor({ scrollTop: 999 * ROW_HEIGHT, viewport: 600, count: 1000 })

    expect(shown.last).toBe(999)
    expect(shown.below).toBe(0)
  })

  it('covers every row the viewport can see, which is the whole point', () => {
    for (const scrollTop of [0, 17, 240, 3001, 29_970]) {
      const shown = windowFor({ scrollTop, viewport: 640, count: 1000 })
      const firstVisible = Math.floor(scrollTop / ROW_HEIGHT)
      const lastVisible = Math.min(999, Math.ceil((scrollTop + 640) / ROW_HEIGHT) - 1)

      expect(shown.first, `row ${firstVisible} would be blank at ${scrollTop}`).toBeLessThanOrEqual(
        firstVisible,
      )
      expect(
        shown.last,
        `row ${lastVisible} would be blank at ${scrollTop}`,
      ).toBeGreaterThanOrEqual(lastVisible)
    }
  })

  it('takes a negative scroll, which a rubber-banding browser really does send', () => {
    expect(windowFor({ scrollTop: -80, viewport: 600, count: 1000 }).first).toBe(0)
  })

  it('asks for more only near the bottom', () => {
    expect(reachedTheEnd(0, 600, 30_000)).toBe(false)
    expect(reachedTheEnd(29_400, 600, 30_000)).toBe(true)
  })
})

describe('the height the table draws and the height it measures', () => {
  it('are the same number, or every row after the first sits wrong', () => {
    expect(TABLE).toContain(`ROW_CLASS = 'h-[${ROW_HEIGHT}px]'`)
  })

  it('gives a row outside the window the same box, so the scrollbar does not jump', () => {
    expect(TABLE).toMatch(
      /at < shown\.first \|\| at > shown\.last[\s\S]{0,120}className=\{ROW_CLASS\}/,
    )
  })

  it('writes no style attribute, because the policy has no nonce for one', () => {
    expect(TABLE).not.toMatch(/style=\{/)
  })

  it('widens the clock when the date is in it, or the timestamp is cut off', () => {
    expect(TABLE).toContain('grid-cols-[13ch_')
    expect(TABLE).toContain('grid-cols-[21ch_')
    expect(TABLE).toContain('withDay ? COLUMNS.day : COLUMNS.clock')
  })

  it('writes every width as a literal, because Tailwind cannot see a built one', () => {
    for (const found of TABLE.matchAll(/grid-cols-\[[^\]]*\]/g)) {
      expect(found[0], 'a class built at runtime is never compiled').not.toContain('${')
    }
  })
})
