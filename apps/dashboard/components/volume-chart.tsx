'use client'

import { BarChart } from 'echarts/charts'
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/button'
import { optionFor, readPalette } from '@/lib/chart-theme'
import type { Level } from '@/lib/explorer'
import type { Volume } from '@/lib/histogram'
import { clockText } from '@/lib/when'

echarts.use([
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  AriaComponent,
  CanvasRenderer,
])

export const CHART_HEIGHT = 'h-32'

export function VolumeChart({
  volume,
  withDay,
  busy,
}: {
  volume: Volume
  withDay: boolean
  busy: boolean
}) {
  const t = useTranslations('Volume')
  const levels = useTranslations('Levels')
  const locale = useLocale()

  const box = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | undefined>(undefined)
  const [asTable, setAsTable] = useState(false)

  const draw = useCallback(() => {
    const drawn = chart.current
    if (drawn === undefined) {
      return
    }
    drawn.setOption(
      optionFor(volume, readPalette(), (level: Level) => levels(level), t('describe')),
      { notMerge: true },
    )
  }, [volume, levels, t])

  useEffect(() => {
    const target = box.current
    if (target === null || asTable) {
      return
    }

    const drawn = echarts.init(target, undefined, { renderer: 'canvas' })
    chart.current = drawn

    const watcher = new ResizeObserver(() => drawn.resize())
    watcher.observe(target)

    return () => {
      watcher.disconnect()
      drawn.dispose()
      chart.current = undefined
    }
  }, [asTable])

  useEffect(() => {
    draw()
  }, [draw])

  useEffect(() => {
    const watcher = new MutationObserver(() => draw())
    watcher.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => watcher.disconnect()
  }, [draw])

  const counted = t('counted', { count: volume.total })

  return (
    <section aria-label={t('label')} className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-aside text-muted-foreground">{busy ? t('loading') : counted}</p>
        <Button
          variant="quiet"
          className="h-6 px-2 text-aside"
          aria-pressed={asTable}
          onClick={() => setAsTable(!asTable)}
        >
          {asTable ? t('asChart') : t('asTable')}
        </Button>
      </div>

      {asTable ? (
        <VolumeTable volume={volume} withDay={withDay} locale={locale} name={levels} />
      ) : (
        <div ref={box} className={CHART_HEIGHT} role="img" aria-label={t('describe')} />
      )}
    </section>
  )
}

function VolumeTable({
  volume,
  withDay,
  locale,
  name,
}: {
  volume: Volume
  withDay: boolean
  locale: string
  name: (level: Level) => string
}) {
  const t = useTranslations('Volume')

  return (
    <div className="max-h-48 overflow-auto">
      <table className="w-full border-collapse text-aside">
        <caption className="sr-only">{t('describe')}</caption>
        <thead>
          <tr className="border-border border-b text-muted-foreground">
            <th scope="col" className="px-2 py-1 text-left font-medium">
              {t('when')}
            </th>
            {volume.bands.map((band) => (
              <th key={band.level} scope="col" className="px-2 py-1 text-right font-medium">
                {name(band.level)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {volume.buckets.map((moment, at) => (
            <tr key={moment}>
              <th
                scope="row"
                className="px-2 py-0.5 text-left font-mono font-normal text-muted-foreground tabular-nums"
              >
                {clockText(moment, locale, withDay)}
              </th>
              {volume.bands.map((band) => (
                <td key={band.level} className="px-2 py-0.5 text-right font-mono tabular-nums">
                  {band.counts[at] ?? 0}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
