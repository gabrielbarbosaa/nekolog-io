'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/button'
import { inputStyle, Notice } from '@/components/field'
import { call } from '@/lib/client'

export function NewProject({ org }: { org: string }) {
  const t = useTranslations('Projects')
  const errors = useTranslations('Errors')
  const router = useRouter()

  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        setError(undefined)

        const answer = await call<{ project: string }>(`/api/orgs/${org}/projects`, { name })
        setBusy(false)
        if (answer.ok) {
          setName('')
          router.push(`/${org}/${answer.body.project}/settings`)
          router.refresh()
        } else {
          setError(answer.error)
        }
      }}
    >
      <div className="flex gap-2">
        <input
          className={`${inputStyle} max-w-xs`}
          name="name"
          value={name}
          required
          placeholder={t('name')}
          aria-label={t('name')}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" variant="solid" disabled={busy}>
          {busy ? t('creating') : t('create')}
        </Button>
      </div>

      {error === undefined ? null : (
        <Notice kind="bad">{errors.has(error) ? errors(error) : errors('unknown')}</Notice>
      )}
    </form>
  )
}
