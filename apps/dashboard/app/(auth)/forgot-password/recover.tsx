'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/button'
import { Field, Notice } from '@/components/field'
import { call } from '@/lib/client'

export function Recover() {
  const t = useTranslations('Auth')
  const errors = useTranslations('Errors')

  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  if (sent) {
    return (
      <div className="flex flex-col gap-5">
        <Notice kind="good">{t('forgotSent')}</Notice>
        <Button asChild variant="solid">
          <Link href="/reset-password">{t('continue')}</Link>
        </Button>
      </div>
    )
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        setError(undefined)

        const answer = await call('/api/auth/password/forgot', { email })
        setBusy(false)
        if (answer.ok) {
          setSent(true)
        } else {
          setError(answer.error)
        }
      }}
    >
      <Field
        label={t('email')}
        name="email"
        type="email"
        value={email}
        autoComplete="email"
        autoFocus
        required
        onChange={(event) => setEmail(event.target.value)}
      />

      {error === undefined ? null : (
        <Notice kind="bad">{errors.has(error) ? errors(error) : errors('unknown')}</Notice>
      )}

      <Button type="submit" variant="solid" disabled={busy}>
        {t('continue')}
      </Button>
    </form>
  )
}
