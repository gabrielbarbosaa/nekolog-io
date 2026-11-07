'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/button'
import { Notice } from '@/components/field'
import { call } from '@/lib/client'

export function EnterTheDemo({ organization }: { organization: string }) {
  const t = useTranslations('Demo')
  const errors = useTranslations('Errors')
  const router = useRouter()

  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string | undefined>(undefined)

  async function enter() {
    setBusy(true)
    setRefused(undefined)

    const answer = await call<{ organization: string }>('/api/demo', {})
    if (answer.ok) {
      router.replace(`/${answer.body.organization}/projects`)
      return
    }

    setBusy(false)
    setRefused(answer.error)
  }

  return (
    <div className="flex flex-col gap-4">
      <Button variant="solid" onClick={() => void enter()} disabled={busy}>
        {busy ? t('entering') : t('enter')}
      </Button>

      <p className="text-aside text-muted-foreground">{t('readOnly', { organization })}</p>

      {refused === undefined ? null : (
        <Notice kind="bad">{errors.has(refused) ? errors(refused) : errors('unknown')}</Notice>
      )}
    </div>
  )
}
