'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/button'
import { CodeStep } from '@/components/code-step'
import { Field, Notice } from '@/components/field'
import { call } from '@/lib/client'

type Step = 'details' | 'code' | 'done'

export function SignUp({ invite, minPassword }: { invite: string; minPassword: number }) {
  const t = useTranslations('Auth')
  const errors = useTranslations('Errors')

  const [step, setStep] = useState<Step>('details')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  async function create(): Promise<void> {
    setBusy(true)
    setError(undefined)

    const answer = await call<{ email?: string }>('/api/auth/signup', {
      invite,
      name,
      password,
      locale: document.documentElement.lang,
    })
    setBusy(false)

    if (answer.ok) {
      setEmail(answer.body.email ?? '')
      setStep('code')
      return
    }
    setError(answer.error)
  }

  async function confirm(code: string): Promise<void> {
    setBusy(true)
    setError(undefined)

    const answer = await call('/api/auth/verify-email', { code })
    setBusy(false)

    if (answer.ok) {
      setStep('done')
      return
    }
    setError(answer.error)
  }

  if (step === 'done') {
    return (
      <div className="flex flex-col gap-5">
        <Notice kind="good">{t('confirmed')}</Notice>
        <Button asChild variant="solid">
          <Link href="/login">{t('goToSignIn')}</Link>
        </Button>
      </div>
    )
  }

  if (step === 'code') {
    return (
      <CodeStep
        email={email}
        submitting={busy}
        error={error}
        action={t('confirm')}
        onSubmit={(code) => void confirm(code)}
      />
    )
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        void create()
      }}
    >
      <Field
        label={t('name')}
        name="name"
        value={name}
        autoComplete="name"
        autoFocus
        required
        onChange={(event) => setName(event.target.value)}
      />

      <Field
        label={t('password')}
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
