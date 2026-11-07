'use client'

import { useLocale, useTranslations } from 'next-intl'
import { EnvDot } from '@/components/env-dot'
import { LevelTag } from '@/components/log-level'
import { textOf } from '@/lib/explorer'
import { offsetLabel, type Trace } from '@/lib/trace'
import { clockText } from '@/lib/when'

export function TraceTimeline({
  trace,
  environments,
}: {
  trace: Trace
  environments: Readonly<Record<string, { name: string; color: string | undefined }>>
}) {
  const t = useTranslations('Trace')
  const locale = useLocale()

  if (trace.steps.length === 0) {
    return (
      <p role="status" className="px-4 py-10 text-center text-muted-foreground">
        {t('nothing')}
      </p>
    )
  }

  return (
    <ol aria-label={t('timeline')} className="flex flex-col">
      {trace.steps.map((step) => {
        const environment = environments[textOf(step.row, 'environment_id')]
        return (
          <li key={step.key} className={step.handover ? 'border-border border-t pt-2' : ''}>
            <article className="grid grid-cols-[9ch_minmax(0,1fr)] items-baseline gap-x-3 px-4 py-1">
              <span className="text-right font-mono text-aside text-muted-foreground tabular-nums">
                {offsetLabel(step.offsetMs)}
              </span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-aside text-muted-foreground">
                  <LevelTag level={step.level} />
                  <span className="font-medium text-foreground">{step.service}</span>
                  <span className="font-mono">{step.source}</span>
                  {environment === undefined ? null : (
                    <span className="flex items-center gap-1.5">
                      <EnvDot colour={environment.color} />
                      {environment.name}
                    </span>
                  )}
                  <span className="font-mono tabular-nums">{clockText(step.at, locale)}</span>
                </p>
                <p className="break-words text-data">{textOf(step.row, 'message')}</p>
              </div>
            </article>
          </li>
        )
      })}
    </ol>
  )
}
