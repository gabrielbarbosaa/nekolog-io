'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/button'
import { Field, Notice } from '@/components/field'
import { call } from '@/lib/client'

export function NewOrganization() {
  const t = useTranslations('Projects')
  const errors = useTranslations('Errors')
  const router = useRouter()

  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  return (
    <form
      className="flex max-w-sm flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        setError(undefined)

        const answer = await call<{ organization: string }>('/api/orgs', { name })
        setBusy(false)
        if (answer.ok) {
          router.replace(`/${answer.body.organization}/projects`)
          router.refresh()
        } else {
          setError(answer.error)
        }
      }}
    >
      <Field
        label={t('organizationName')}
        name="name"
        value={name}
        autoFocus
        required
        onChange={(event) => setName(event.target.value)}
      />

      {error === undefined ? null : (
        <Notice kind="bad">{errors.has(error) ? errors(error) : errors('unknown')}</Notice>
      )}

      <Button type="submit" variant="solid" disabled={busy} className="self-start">
        {t('createOrganization')}
      </Button>
    </form>
  )
}
