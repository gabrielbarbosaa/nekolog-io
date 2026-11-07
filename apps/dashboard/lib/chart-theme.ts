import { LEVELS, type Level } from './explorer'
import type { Volume } from './histogram'
import { asPaintable, withAlpha } from './oklch'

export const CHROME_TOKENS = [
  'foreground',
  'muted-foreground',
  'border',
  'background',
  'popover',
  'popover-foreground',
] as const

export const LEVEL_TOKENS: readonly string[] = LEVELS.map((level) => `level-${level}`)

export const CHART_TOKENS: readonly string[] = [...CHROME_TOKENS, ...LEVEL_TOKENS]

export type Chrome = Record<(typeof CHROME_TOKENS)[number], string>

export type Palette = {
  chrome: Chrome
  level: Record<Level, string>
}

export function paletteFrom(read: (token: string) => string): Palette {
  const chrome = Object.fromEntries(
    CHROME_TOKENS.map((token) => [token, asPaintable(read(token))]),
  ) as Chrome

  const level = Object.fromEntries(
    LEVELS.map((one) => [one, asPaintable(read(`level-${one}`))]),
  ) as Record<Level, string>

  return { chrome, level }
}

export function readPalette(): Palette {
  const styles = getComputedStyle(document.documentElement)
  return paletteFrom((token) => styles.getPropertyValue(`--${token}`))
}

export type ChartTheme = {
  textStyle: { color: string; fontSize: number }
  grid: { left: number; right: number; top: number; bottom: number; containLabel: boolean }
  xAxis: Record<string, unknown>
  yAxis: Record<string, unknown>
  tooltip: Record<string, unknown>
  legend: Record<string, unknown>
}

export function themeFor(palette: Palette): ChartTheme {
  const faint = { lineStyle: { color: palette.chrome.border } }

  return {
    textStyle: { color: palette.chrome['muted-foreground'], fontSize: 11 },
    grid: { left: 8, right: 8, top: 8, bottom: 22, containLabel: true },
    xAxis: {
      type: 'time',
      axisLine: faint,
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { color: palette.chrome['muted-foreground'], hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: withAlpha(palette.chrome.border, 0.6) } },
      axisLabel: { color: palette.chrome['muted-foreground'] },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: palette.chrome.popover,
      borderColor: palette.chrome.border,
      textStyle: { color: palette.chrome['popover-foreground'], fontSize: 12 },
    },
    legend: {
      bottom: 0,
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: palette.chrome['muted-foreground'], fontSize: 11 },
      inactiveColor: withAlpha(palette.chrome['muted-foreground'], 0.4),
    },
  }
}

export const STACK = 'volume'

export type Named = (level: Level) => string

export function optionFor(
  volume: Volume,
  palette: Palette,
  name: Named,
  describe: string,
): Record<string, unknown> {
  const theme = themeFor(palette)

  return {
    ...theme,
    animation: false,
    aria: { enabled: true, decal: { show: true }, label: { description: describe } },
    series: volume.bands.map((band) => ({
      name: name(band.level),
      type: 'bar',
      stack: STACK,
      barMaxWidth: 28,
      large: true,
      itemStyle: { color: palette.level[band.level], borderWidth: 0 },
      data: volume.buckets.map((moment, at) => [moment, band.counts[at] ?? 0]),
    })),
  }
}
