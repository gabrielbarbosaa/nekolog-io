'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/button'
import { CodeStep } from '@/components/code-step'
import { Field, Notice } from '@/components/field'
import { call } from '@/lib/client'

type Step = 'password' | 'code'

export function SignIn() {
  const t = useTranslations('Auth')
  const errors = useTranslations('Errors')
  const router = useRouter()

  const [step, setStep] = useState<Step>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  async function start(): Promise<void> {
    setBusy(true)
    setError(undefined)

    const answer = await call('/api/auth/login/start', { email, password })
    setBusy(false)

    if (answer.ok) {
      setStep('code')
      return
    }
    setError(answer.error)
  }

  async function verify(code: string): Promise<void> {
    setBusy(true)
    setError(undefined)

    const answer = await call('/api/auth/login/verify', { code, remember })
    setBusy(false)

    if (answer.ok) {
      router.replace('/')
      router.refresh()
      return
    }
    setError(answer.error)
  }

  if (step === 'code') {
    return (
      <CodeStep
        email={email}
        submitting={busy}
        error={error}
        action={t('verify')}
        onSubmit={(code) => void verify(code)}
        onResend={async () => {
          const answer = await call('/api/auth/login/resend', {})
          return answer.ok ? undefined : 60
        }}
        onBack={() => {
          setStep('password')
          setError(undefined)
        }}
      />
    )
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        void start()
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

      <Field
        label={t('password')}
        name="password"
        type="password"
        value={password}
        autoComplete="current-password"
        required
        onChange={(event) => setPassword(event.target.value)}
      />

      <label className="flex items-center gap-2 text-aside text-muted-foreground">
        <input
          type="checkbox"
          checked={remember}
          className="size-4 accent-primary"
          onChange={(event) => setRemember(event.target.checked)}
        />
        {t('remember')}
      </label>

      {error === undefined ? null : (
        <Notice kind="bad">{errors.has(error) ? errors(error) : errors('unknown')}</Notice>
      )}

      <Button type="submit" variant="solid" disabled={busy}>
        {t('continue')}
      </Button>

      <Link
        href="/forgot-password"
        className="text-aside text-muted-foreground underline-offset-4 hover:underline"
      >
        {t('forgot')}
      </Link>
    </form>
  )
}
