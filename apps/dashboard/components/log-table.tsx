'use client'

import { useLocale, useTranslations } from 'next-intl'
import { type UIEvent, useCallback, useState } from 'react'
import { LEVEL_TEXT } from '@/components/log-level'
import { type LogRow, levelOf, momentOf, textOf } from '@/lib/explorer'
import { cn } from '@/lib/utils'
import { ROW_HEIGHT, reachedTheEnd, windowFor } from '@/lib/virtual'
import { clockText } from '@/lib/when'

export const ROW_CLASS = 'h-[30px]'

const SHARED = 'grid items-center gap-2 px-3 text-left'

const COLUMNS: Readonly<Record<'clock' | 'day', string>> = {
  clock: `${SHARED} grid-cols-[13ch_6ch_16ch_minmax(0,1fr)]`,
  day: `${SHARED} grid-cols-[21ch_6ch_16ch_minmax(0,1fr)]`,
}

export function LogTable({
  rows,
  withDay,
  selected,
  onSelect,
  onEnd,
}: {
  rows: readonly LogRow[]
  withDay: boolean
  selected: number
  onSelect: (at: number) => void
  onEnd: () => void
}) {
  const t = useTranslations('Explorer')
  const locale = useLocale()
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(720)

  const onScroll = useCallback(
    (event: UIEvent<HTMLUListElement>) => {
      const target = event.currentTarget
      setScrollTop(target.scrollTop)
      setViewport(target.clientHeight)
      if (reachedTheEnd(target.scrollTop, target.clientHeight, rows.length * ROW_HEIGHT)) {
        onEnd()
      }
    },
    [onEnd, rows.length],
  )

  const shown = windowFor({ scrollTop, viewport, count: rows.length })

  return (
    <ul
      onScroll={onScroll}
      aria-label={t('tableLabel')}
      className="h-full overflow-auto overscroll-contain text-data"
    >
      {rows.map((row, at) => {
        const key = `${textOf(row, 'timestamp')}:${at}`

        if (at < shown.first || at > shown.last) {
          return <li key={key} aria-hidden className={ROW_CLASS} />
        }

        const level = levelOf(row)

        return (
          <li key={key} className={ROW_CLASS}>
            <button
              type="button"
              aria-current={at === selected ? 'true' : undefined}
              onClick={() => onSelect(at)}
              className={cn(
                withDay ? COLUMNS.day : COLUMNS.clock,
                ROW_CLASS,
                'w-full rounded-none hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                at === selected && 'bg-muted',
              )}
            >
              <span className="truncate font-mono text-muted-foreground tabular-nums">
                {clockText(momentOf(row), locale, withDay)}
              </span>
              <span className={cn('truncate font-medium', LEVEL_TEXT[level])}>{level}</span>
              <span className="truncate text-muted-foreground">{textOf(row, 'service')}</span>
              <span className="truncate">{textOf(row, 'message')}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
