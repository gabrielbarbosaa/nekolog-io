import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CHART_TOKENS,
  CHROME_TOKENS,
  LEVEL_TOKENS,
  optionFor,
  type Palette,
  paletteFrom,
  STACK,
  themeFor,
} from '../lib/chart-theme'
import { LEVELS } from '../lib/explorer'
import { volumeFrom } from '../lib/histogram'

const CSS = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8')
const CHART = readFileSync(
  fileURLToPath(new URL('../components/volume-chart.tsx', import.meta.url)),
  'utf8',
)

const ROOT = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('.dark {'))
const DARK = CSS.slice(CSS.indexOf('.dark {'), CSS.indexOf('@theme'))

const PALETTE: Palette = paletteFrom((token) =>
  token.startsWith('level-') ? 'oklch(0.623 0.191 24.912)' : 'oklch(0.5 0 0)',
)

describe('the tokens this chart paints with', () => {
  it('found the stylesheet, so none of this is passing on an empty list', () => {
    expect(ROOT.length).toBeGreaterThan(500)
    expect(DARK.length).toBeGreaterThan(500)
    expect(CHART_TOKENS.length).toBe(CHROME_TOKENS.length + LEVELS.length)
  })

  it.each(CHART_TOKENS)('%s is declared for the light theme', (token) => {
    expect(ROOT).toContain(`--${token}:`)
  })

  it.each(CHART_TOKENS)(
    '%s is declared for the dark theme too, or the chart goes blind',
    (token) => {
      expect(DARK).toContain(`--${token}:`)
    },
  )

  it('names one token per level, derived rather than written out', () => {
    expect(LEVEL_TOKENS).toEqual(LEVELS.map((level) => `level-${level}`))
  })

  it('turns every token into something a canvas can paint', () => {
    for (const value of [...Object.values(PALETTE.chrome), ...Object.values(PALETTE.level)]) {
      expect(value, 'echarts cannot do colour maths on oklch()').toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('hands back whatever it read when that is not a token it can convert', () => {
    const odd = paletteFrom(() => 'rebeccapurple')

    expect(odd.chrome.border).toBe('rebeccapurple')
  })
})

describe('the chart the theme builds', () => {
  const volume = volumeFrom(
    [
      { bucket: '2026-11-06 19:00:00', level: 'error', events: '2' },
      { bucket: '2026-11-06 19:05:00', level: 'info', events: '7' },
    ],
    [Date.parse('2026-11-06T19:00:00Z'), Date.parse('2026-11-06T19:05:00Z')],
  )

  const option = optionFor(volume, PALETTE, (level) => `the ${level}`, 'what this shows')

  it('draws one band per level that actually sent something', () => {
    const series = option.series as Array<{ name: string; stack: string; type: string }>

    expect(series).toHaveLength(2)
    expect(series.map((one) => one.name)).toEqual(['the info', 'the error'])
    expect(series.every((one) => one.type === 'bar')).toBe(true)
  })

  it('stacks them, because the height is the volume of the slice', () => {
    const series = option.series as Array<{ stack: string }>

    expect(new Set(series.map((one) => one.stack))).toEqual(new Set([STACK]))
  })

  it('pairs every count with the moment it belongs to', () => {
    const series = option.series as Array<{ data: Array<[number, number]> }>
    const info = series[0]?.data

    expect(info).toEqual([
      [Date.parse('2026-11-06T19:00:00Z'), 0],
      [Date.parse('2026-11-06T19:05:00Z'), 7],
    ])
  })

  it('turns the textures on, which is what colour blindness needs', () => {
    expect(option.aria).toMatchObject({ enabled: true, decal: { show: true } })
  })

  it('describes itself, so a screen reader is told what it is looking at', () => {
    expect(option.aria).toMatchObject({ label: { description: 'what this shows' } })
  })

  it('carries a legend and a tooltip rather than leaving the bars unlabelled', () => {
    expect(option.legend).toBeDefined()
    expect(option.tooltip).toMatchObject({ trigger: 'axis' })
  })

  it('reads the clock along the bottom, not a list of categories', () => {
    expect(themeFor(PALETTE).xAxis).toMatchObject({ type: 'time' })
  })

  it('counts in whole lines, because half a log line is not a thing', () => {
    expect(themeFor(PALETTE).yAxis).toMatchObject({ minInterval: 1 })
  })
})

describe('what the chart component does with all that', () => {
  it('loads only the pieces it draws with, not the whole of echarts', () => {
    expect(CHART, 'importing echarts whole pulls in every chart type').not.toMatch(
      /from 'echarts'$/m,
    )
    expect(CHART).toContain("from 'echarts/core'")
    expect(CHART).toContain('AriaComponent')
  })

  it('redraws when the html class changes, not when a theme hook says it will', () => {
    expect(
      CHART,
      'next-themes can report the new theme before the class lands, and then the palette read ' +
        'is still the old one',
    ).not.toContain('useTheme')
    expect(CHART).toContain("attributeFilter: ['class']")
    expect(CHART).toMatch(/new MutationObserver\(\(\) => draw\(\)\)/)
    expect(CHART, 'the palette is read inside the draw, never captured once').toMatch(
      /const draw = useCallback\(\(\) => \{[\s\S]{0,400}readPalette\(\)/,
    )
  })

  it('lets go of everything it attached when the screen goes away', () => {
    expect(CHART).toContain('drawn.dispose()')
    expect([...CHART.matchAll(/watcher\.disconnect\(\)/g)], 'one per observer').toHaveLength(2)
  })

  it('offers the same numbers as a real table', () => {
    expect(CHART).toContain('<table')
    expect(CHART).toContain('scope="col"')
    expect(CHART).toContain('scope="row"')
  })

  it('writes no style attribute, because the policy has no nonce for one', () => {
    expect(CHART).not.toMatch(/style=\{/)
  })
})
