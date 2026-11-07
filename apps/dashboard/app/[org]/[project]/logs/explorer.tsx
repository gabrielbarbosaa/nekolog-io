'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Notice } from '@/components/field'
import { LogDetail } from '@/components/log-detail'
import { LogTable } from '@/components/log-table'
import { type EnvironmentChoice, QueryBar } from '@/components/query-bar'
import { call } from '@/lib/client'
import {
  appendPage,
  type LogRow,
  momentOf,
  olderEnd,
  type Query,
  searchOf,
  windowOf,
} from '@/lib/explorer'

const PAGE = 200
const LIVE_EVERY_MS = 3000
const MOST_ROWS = 5000

type Loaded = { rows: LogRow[]; exhausted: boolean }

export function Explorer({
  org,
  project,
  environments,
  initial,
}: {
  org: string
  project: string
  environments: readonly EnvironmentChoice[]
  initial: Query
}) {
  const t = useTranslations('Explorer')
  const errors = useTranslations('Errors')
  const router = useRouter()
  const pathname = usePathname()

  const [query, setQuery] = useState<Query>(initial)
  const [loaded, setLoaded] = useState<Loaded>({ rows: [], exhausted: false })
  const [busy, setBusy] = useState(true)
  const [refused, setRefused] = useState<{ code: string; detail?: string } | undefined>(undefined)
  const [selected, setSelected] = useState(-1)
  const [context, setContext] = useState<LogRow[] | undefined>(undefined)
  const [live, setLive] = useState(false)

  const anchor = useRef(Date.now())
  const loading = useRef(false)

  const logsPath = `/api/orgs/${org}/projects/${project}/logs`

  const fetchPage = useCallback(
    async (to: Date, from: Date): Promise<LogRow[] | undefined> => {
      const params = new URLSearchParams({
        env: query.environmentId,
        from: from.toISOString(),
        to: to.toISOString(),
        limit: String(PAGE),
      })
      if (query.search !== '') {
        params.set('q', query.search)
      }

      const answer = await call<{ rows: LogRow[] }>(`${logsPath}?${params.toString()}`)
      if (!answer.ok) {
        setRefused({ code: answer.error, ...(answer.detail ? { detail: answer.detail } : {}) })
        return undefined
      }

      setRefused(undefined)
      return answer.body.rows
    },
    [logsPath, query.environmentId, query.search],
  )

  const reload = useCallback(
    async (at: number) => {
      if (query.environmentId === '') {
        return
      }
      loading.current = true
      setBusy(true)
      anchor.current = at

      const span = windowOf(query.period, at)
      const page = await fetchPage(span.to, span.from)

      setLoaded({ rows: page ?? [], exhausted: page !== undefined && page.length < PAGE })
      setBusy(false)
      loading.current = false
    },
    [fetchPage, query.environmentId, query.period],
  )

  useEffect(() => {
    setSelected(-1)
    setContext(undefined)
    void reload(Date.now())
  }, [reload])

  useEffect(() => {
    router.replace(`${pathname}?${searchOf(query)}`, { scroll: false })
  }, [pathname, query, router])

  useEffect(() => {
    if (!live) {
      return
    }
    const timer = setInterval(() => {
      if (!loading.current) {
        void reload(Date.now())
      }
    }, LIVE_EVERY_MS)
    return () => clearInterval(timer)
  }, [live, reload])

  const loadMore = useCallback(() => {
    if (loading.current || loaded.exhausted || live || loaded.rows.length >= MOST_ROWS) {
      return
    }
    loading.current = true
    setBusy(true)

    const span = windowOf(query.period, anchor.current)
    void (async () => {
      const page = await fetchPage(olderEnd(loaded.rows, span.to), span.from)
      if (page !== undefined) {
        setLoaded((held) => ({
          rows: appendPage(held.rows, page),
          exhausted: page.length < PAGE,
        }))
      }
      setBusy(false)
      loading.current = false
    })()
  }, [fetchPage, live, loaded.exhausted, loaded.rows, query.period])

  const open = useCallback(
    (at: number) => {
      const row = loaded.rows[at]
      setSelected(at)
      setContext(undefined)
      setQuery((held) => ({
        ...held,
        at: row === undefined ? '' : new Date(momentOf(row)).toISOString(),
      }))
    },
    [loaded.rows],
  )

  useEffect(() => {
    if (initial.at === '' || loaded.rows.length === 0 || selected !== -1) {
      return
    }
    const wanted = Date.parse(initial.at)
    const found = loaded.rows.findIndex((row) => momentOf(row) === wanted)
    if (found !== -1) {
      setSelected(found)
    }
  }, [initial.at, loaded.rows, selected])

  const showContext = useCallback(async () => {
    const row = loaded.rows[selected]
    if (row === undefined) {
      return
    }
    if (context !== undefined) {
      setContext(undefined)
      return
    }

    const params = new URLSearchParams({
      env: query.environmentId,
      at: new Date(momentOf(row)).toISOString(),
    })
    const answer = await call<{ rows: LogRow[] }>(`${logsPath}/context?${params.toString()}`)
    if (answer.ok) {
      setContext(answer.body.rows)
    } else {
      setRefused({ code: answer.error })
    }
  }, [context, loaded.rows, logsPath, query.environmentId, selected])

  const shown = context ?? loaded.rows
  const row = loaded.rows[selected]
  const environment = environments.find((one) => one.id === query.environmentId)
  const withDay = query.period === '7d' || query.period === '30d'

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="border-border border-b px-3 py-2">
        <QueryBar
          environments={environments}
          query={query}
          onChange={(next) => {
            setContext(undefined)
            setQuery(next)
          }}
          live={live}
          onLive={setLive}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {refused === undefined ? null : (
            <div className="px-3 py-2">
              <Notice kind="bad">
                {refused.detail ??
                  (errors.has(refused.code) ? errors(refused.code) : errors('unknown'))}
              </Notice>
            </div>
          )}

          {context === undefined ? null : (
            <p className="px-3 py-2 text-aside text-muted-foreground">{t('contextShown')}</p>
          )}

          {shown.length === 0 && !busy && refused === undefined ? (
            <p className="px-3 py-6 text-muted-foreground">{t('nothing')}</p>
          ) : (
            <LogTable
              rows={shown}
              withDay={withDay}
              selected={context === undefined ? selected : -1}
              onSelect={open}
              onEnd={loadMore}
            />
          )}

          <p
            aria-live="polite"
            className="border-border border-t px-3 py-1.5 text-aside text-muted-foreground"
          >
            {busy ? t('loading') : t('counted', { count: shown.length })}
          </p>
        </div>

        {row === undefined ? null : (
          <div className="hidden w-[28rem] shrink-0 lg:flex">
            <LogDetail
              row={row}
              environment={environment?.name ?? ''}
              colour={environment?.color}
              onClose={() => {
                setSelected(-1)
                setContext(undefined)
                setQuery((held) => ({ ...held, at: '' }))
              }}
              onContext={() => void showContext()}
              context={context === undefined ? 'idle' : 'open'}
            />
          </div>
        )}
      </div>
    </div>
  )
}
