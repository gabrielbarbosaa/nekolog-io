'use client'

import { Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type FormEvent, useEffect, useState } from 'react'
import { EnvDot } from '@/components/env-dot'
import { PERIODS, type Period, type Query } from '@/lib/explorer'
import { cn } from '@/lib/utils'

export type EnvironmentChoice = { id: string; name: string; color: string | undefined }

export function QueryBar({
  environments,
  query,
  onChange,
  live,
  onLive,
}: {
  environments: readonly EnvironmentChoice[]
  query: Query
  onChange: (next: Query) => void
  live: boolean
  onLive: (next: boolean) => void
}) {
  const t = useTranslations('Explorer')
  const [typed, setTyped] = useState(query.search)

  useEffect(() => {
    setTyped(query.search)
  }, [query.search])

  const chosen = environments.find((one) => one.id === query.environmentId)

  function submit(event: FormEvent) {
    event.preventDefault()
    onChange({ ...query, search: typed.trim(), at: '' })
  }

  return (
    <form
      onSubmit={submit}
      className="flex min-w-0 items-center gap-px rounded-md border border-border"
    >
      <label className="flex shrink-0 items-center gap-1.5 rounded-l-md px-2.5 py-1.5 focus-within:bg-muted">
        <EnvDot colour={chosen?.color} />
        <span className="sr-only">{t('environment')}</span>
        <select
          value={query.environmentId}
          onChange={(event) => onChange({ ...query, environmentId: event.target.value, at: '' })}
          className="bg-transparent outline-none"
        >
          {environments.map((one) => (
            <option key={one.id} value={one.id}>
              {one.name}
            </option>
          ))}
        </select>
      </label>

      <span aria-hidden className="h-5 w-px shrink-0 bg-border" />

      <label className="flex shrink-0 items-center px-2.5 py-1.5 focus-within:bg-muted">
        <span className="sr-only">{t('period')}</span>
        <select
          value={query.period}
          onChange={(event) => onChange({ ...query, period: event.target.value as Period, at: '' })}
          className="bg-transparent outline-none"
        >
          {PERIODS.map((period) => (
            <option key={period} value={period}>
              {t(`period_${period}`)}
            </option>
          ))}
        </select>
      </label>

      <span aria-hidden className="h-5 w-px shrink-0 bg-border" />

      <span className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5">
        <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={t('searchHint')}
          aria-label={t('search')}
          className="min-w-0 flex-1 bg-transparent font-mono outline-none placeholder:text-muted-foreground"
        />
      </span>

      <span aria-hidden className="h-5 w-px shrink-0 bg-border" />

      <button
        type="button"
        aria-pressed={live}
        onClick={() => onLive(!live)}
        className={cn(
          'shrink-0 rounded-r-md px-2.5 py-1.5 text-muted-foreground hover:bg-muted',
          live && 'text-foreground',
        )}
      >
        {t('live')}
      </button>
    </form>
  )
}
