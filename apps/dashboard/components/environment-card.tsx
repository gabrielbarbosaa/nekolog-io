'use client'

import type { Environment } from '@internal/auth'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/button'
import { COLOUR_NAMES, COLOURS, EnvDot } from '@/components/env-dot'
import { Area, Field, Notice, Select } from '@/components/field'
import { call } from '@/lib/client'

export type Saved = Environment & { originAllowlist?: readonly string[] | undefined }

export function EnvironmentCard({
  org,
  project,
  environment,
  mayWrite,
  onlyOne,
  levels,
}: {
  org: string
  project: string
  environment: Saved
  mayWrite: boolean
  onlyOne: boolean
  levels: readonly string[]
}) {
  const t = useTranslations('Environments')
  const colours = useTranslations('Colours')
  const errors = useTranslations('Errors')
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)

  const [colour, setColour] = useState(environment.color ?? (COLOURS[0] as string))
  const [retention, setRetention] = useState(String(environment.retentionDays))
  const [minLevel, setMinLevel] = useState(environment.minLevel)
  const [sampleRate, setSampleRate] = useState(String(environment.sampleRate))
  const [quota, setQuota] = useState(
    environment.dailyEventQuota === undefined ? '' : String(environment.dailyEventQuota),
  )
  const [origins, setOrigins] = useState((environment.originAllowlist ?? []).join('\n'))

  const where = `/api/orgs/${org}/projects/${project}/environments/${environment.id}`

  async function save(): Promise<void> {
    setBusy(true)
    setError(undefined)
    setSaved(false)

    const list = origins
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')

    const answer = await call(where, {
      color: colour,
      retentionDays: Number(retention),
      minLevel,
      sampleRate: Number(sampleRate),
      dailyEventQuota: quota.trim() === '' ? null : Number(quota),
      originAllowlist: origins.trim() === '' ? null : list,
      redactionRules: environment.redactionRules ?? null,
    })

    setBusy(false)
    if (answer.ok) {
      setSaved(true)
      router.refresh()
    } else {
      setError(answer.error)
    }
  }

  return (
    <li className="border-border border-b py-3">
      <div className="flex items-baseline justify-between gap-4">
        <button
          type="button"
          className="flex min-w-0 items-baseline gap-2 text-left"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <EnvDot colour={environment.color} className="translate-y-[-1px]" />
          <span className="truncate font-mono font-medium">{environment.name}</span>
        </button>

        <span className="shrink-0 text-aside text-muted-foreground">
          {t('retentionUnit', { days: environment.retentionDays })} ·{' '}
          {t('liveKeys', { count: environment.liveKeys })}
        </span>
      </div>

      {open ? (
        <form
          className="mt-4 grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <Select
            label={t('colour')}
            value={colour}
            disabled={!mayWrite}
            onChange={(event) => setColour(event.target.value as typeof colour)}
          >
            {COLOURS.map((one) => (
              <option key={one} value={one}>
                {colours(COLOUR_NAMES[one])}
              </option>
            ))}
          </Select>

          <Field
            label={t('retention')}
            type="number"
            min={1}
            max={365}
            value={retention}
            disabled={!mayWrite}
            onChange={(event) => setRetention(event.target.value)}
          />

          <Select
            label={t('minLevel')}
            value={minLevel}
            disabled={!mayWrite}
            onChange={(event) => setMinLevel(event.target.value as typeof minLevel)}
          >
            {levels.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </Select>

          <Field
            label={t('sampleRate')}
            hint={t('sampleHint')}
            type="number"
            min={0.01}
            max={1}
            step={0.01}
            value={sampleRate}
            disabled={!mayWrite}
            onChange={(event) => setSampleRate(event.target.value)}
          />

          <Field
            label={t('quota')}
            hint={t('quotaNone')}
            type="number"
            min={1}
            value={quota}
            disabled={!mayWrite}
            onChange={(event) => setQuota(event.target.value)}
          />

          <div className="sm:col-span-2">
            <Area
              label={t('origins')}
              hint={t('originsHint')}
              rows={3}
              value={origins}
              disabled={!mayWrite}
              onChange={(event) => setOrigins(event.target.value)}
            />
          </div>

          {error === undefined ? null : (
            <div className="sm:col-span-2">
              <Notice kind="bad">{errors.has(error) ? errors(error) : errors('unknown')}</Notice>
            </div>
          )}
          {saved ? (
            <div className="sm:col-span-2">
              <Notice kind="good">{t('saved')}</Notice>
            </div>
          ) : null}

          {mayWrite ? (
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" variant="solid" disabled={busy}>
                {t('save')}
              </Button>

              <Button
                type="button"
                disabled={busy || onlyOne}
                title={onlyOne ? errors('the_last_environment') : undefined}
                onClick={async () => {
                  setBusy(true)
                  setError(undefined)
                  const answer = await call(`${where}/delete`, {})
                  setBusy(false)
                  if (answer.ok) {
                    router.refresh()
                  } else {
                    setError(answer.error)
                  }
                }}
              >
                {t('remove')}
              </Button>
            </div>
          ) : null}
        </form>
      ) : null}
    </li>
  )
}
