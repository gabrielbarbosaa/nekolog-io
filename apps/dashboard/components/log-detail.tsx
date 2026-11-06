'use client'

import { X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/button'
import { EnvDot } from '@/components/env-dot'
import { LevelTag } from '@/components/log-level'
import { type LogRow, levelOf, momentOf, textOf } from '@/lib/explorer'
import { fullText } from '@/lib/when'

const FIELDS = [
  'service',
  'release',
  'source',
  'error_type',
  'trace_id',
  'span_id',
  'session_id',
  'user_id',
  'country',
] as const

export function LogDetail({
  row,
  environment,
  colour,
  onClose,
  onContext,
  context,
}: {
  row: LogRow
  environment: string
  colour: string | undefined
  onClose: () => void
  onContext: () => void
  context: 'idle' | 'loading' | 'open'
}) {
  const t = useTranslations('Explorer')
  const locale = useLocale()

  const attributes = row.attributes
  const pairs =
    attributes !== null && typeof attributes === 'object' && !Array.isArray(attributes)
      ? Object.entries(attributes as Record<string, unknown>)
      : []

  const stack = textOf(row, 'stacktrace')
  const level = levelOf(row)

  return (
    <aside
      aria-label={t('detailLabel')}
      className="flex w-full min-w-0 flex-col overflow-auto border-border border-l bg-background"
    >
      <header className="flex items-start gap-2 border-border border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-aside text-muted-foreground">
            <EnvDot colour={colour} />
            {environment}
            <LevelTag level={level} />
            <span className="font-mono tabular-nums">{fullText(momentOf(row), locale)}</span>
          </p>
          <p className="mt-1.5 break-words font-medium">{textOf(row, 'message')}</p>
        </div>
        <Button variant="quiet" size="icon" onClick={onClose} aria-label={t('close')}>
          <X aria-hidden className="size-4" />
        </Button>
      </header>

      <div className="flex flex-col gap-5 px-4 py-4">
        <dl className="grid grid-cols-[10ch_minmax(0,1fr)] gap-x-3 gap-y-1">
          {FIELDS.filter((field) => textOf(row, field) !== '').map((field) => (
            <Pair key={field} name={t(field)} value={textOf(row, field)} />
          ))}
        </dl>

        {pairs.length === 0 ? null : (
          <section>
            <h3 className="font-medium text-aside text-muted-foreground">{t('attributes')}</h3>
            <dl className="mt-1.5 grid grid-cols-[minmax(10ch,auto)_minmax(0,1fr)] gap-x-3 gap-y-1">
              {pairs.map(([name, value]) => (
                <Pair key={name} name={name} value={asText(value)} />
              ))}
            </dl>
          </section>
        )}

        {stack === '' ? null : (
          <section>
            <h3 className="font-medium text-aside text-muted-foreground">{t('stacktrace')}</h3>
            <pre className="mt-1.5 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-aside">
              {stack}
            </pre>
          </section>
        )}

        <section>
          <h3 className="font-medium text-aside text-muted-foreground">{t('raw')}</h3>
          <pre className="mt-1.5 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-aside">
            {JSON.stringify(row, null, 2)}
          </pre>
        </section>

        <Button variant="outline" onClick={onContext} disabled={context === 'loading'}>
          {context === 'open' ? t('hideContext') : t('seeContext')}
        </Button>
      </div>
    </aside>
  )
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function Pair({ name, value }: { name: string; value: string }) {
  return (
    <>
      <dt className="truncate text-muted-foreground">{name}</dt>
      <dd className="break-words font-mono">{value}</dd>
    </>
  )
}
