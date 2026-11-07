'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/button'
import { Field, Notice } from '@/components/field'
import { call } from '@/lib/client'

export function Reset({ minPassword }: { minPassword: number }) {
  const t = useTranslations('Auth')
  const errors = useTranslations('Errors')

  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  if (done) {
    return (
      <div className="flex flex-col gap-5">
        <Notice kind="good">{t('resetDone')}</Notice>
        <Button asChild variant="solid">
          <Link href="/login">{t('goToSignIn')}</Link>
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

        const answer = await call('/api/auth/password/reset', { code, password })
        setBusy(false)
        if (answer.ok) {
          setDone(true)
        } else {
          setError(answer.error)
        }
      }}
    >
      <Field
        label={t('code')}
        hint={t('codeHint')}
        name="code"
        value={code}
        mono
        autoComplete="one-time-code"
        autoFocus
        spellCheck={false}
        maxLength={7}
        required
        onChange={(event) => setCode(event.target.value)}
      />

      <Field
        label={t('newPassword')}
        hint={t('passwordRules', { min: minPassword })}
        name="password"
        type="password"
        value={password}
        autoComplete="new-password"
        required
        onChange={(event) => setPassword(event.target.value)}
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
