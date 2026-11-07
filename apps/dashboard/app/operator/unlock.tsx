'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { type FormEvent, useState } from 'react'
import { Button } from '@/components/button'
import { Field, Notice } from '@/components/field'
import { call } from '@/lib/client'

export function Unlock() {
  const t = useTranslations('Operator')
  const errors = useTranslations('Errors')
  const router = useRouter()

  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string | undefined>(undefined)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setRefused(undefined)

    const answer = await call('/api/operator/unlock', { password })
    setBusy(false)

    if (answer.ok) {
      setPassword('')
      router.refresh()
      return
    }
    setRefused(answer.error)
  }

  return (
    <form onSubmit={submit} className="flex max-w-sm flex-col gap-4">
      <div>
        <h1 className="font-semibold text-screen tracking-tight">{t('lockedTitle')}</h1>
        <p className="mt-1 text-muted-foreground">{t('lockedBody')}</p>
      </div>

      <Field
        label={t('password')}
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />

      {refused === undefined ? null : (
        <Notice kind="bad">{errors.has(refused) ? errors(refused) : errors('unknown')}</Notice>
      )}

      <Button type="submit" variant="solid" disabled={busy || password === ''}>
        {busy ? t('unlocking') : t('unlock')}
      </Button>
    </form>
  )
}
