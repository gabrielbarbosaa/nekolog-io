'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/button'
import { COLOUR_NAMES, COLOURS } from '@/components/env-dot'
import { inputStyle, Notice } from '@/components/field'
import { call } from '@/lib/client'

export function NewEnvironment({ org, project }: { org: string; project: string }) {
  const t = useTranslations('Environments')
  const colours = useTranslations('Colours')
  const errors = useTranslations('Errors')
  const router = useRouter()

  const [name, setName] = useState('')
  const [colour, setColour] = useState<string>(COLOURS[0] as string)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  return (
    <form
      className="mt-5 flex flex-col gap-2"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        setError(undefined)

        const answer = await call(`/api/orgs/${org}/projects/${project}/environments`, {
          name,
          color: colour,
        })
        setBusy(false)
        if (answer.ok) {
          setName('')
          router.refresh()
        } else {
          setError(answer.error)
        }
      }}
    >
      <div className="flex flex-wrap gap-2">
        <input
          className={`${inputStyle} max-w-[14rem] font-mono`}
          value={name}
          required
          placeholder="qa"
          aria-label={t('name')}
          onChange={(event) => setName(event.target.value)}
        />
        <select
          className={`${inputStyle} max-w-[9rem] pr-8`}
          value={colour}
          aria-label={t('colour')}
          onChange={(event) => setColour(event.target.value)}
        >
          {COLOURS.map((one) => (
            <option key={one} value={one}>
              {colours(COLOUR_NAMES[one])}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={busy}>
          {t('add')}
        </Button>
      </div>

      <p className="text-aside text-muted-foreground">{t('nameHint')}</p>

      {error === undefined ? null : (
        <Notice kind="bad">{errors.has(error) ? errors(error) : errors('unknown')}</Notice>
      )}
    </form>
  )
}
