'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { Button } from '@/components/button'
import { Field, Notice } from '@/components/field'

export function CodeStep({
  email,
  submitting,
  error,
  onSubmit,
  onResend,
  onBack,
  action,
}: {
  email: string
  submitting: boolean
  error: string | undefined
  onSubmit: (code: string) => void
  onResend?: () => Promise<number | undefined>
  onBack?: () => void
  action: string
}) {
  const t = useTranslations('Auth')
  const errors = useTranslations('Errors')
  const [code, setCode] = useState('')
  const [wait, setWait] = useState(0)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (wait <= 0) {
      return
    }
    const timer = setTimeout(() => setWait((left) => left - 1), 1000)
    return () => clearTimeout(timer)
  }, [wait])

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(code)
      }}
    >
      <p className="text-muted-foreground">{t('codeBody', { email })}</p>

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
        onChange={(event) => setCode(event.target.value)}
      />

      {error === undefined ? null : (
        <Notice kind="bad">{errors.has(error) ? errors(error) : errors('unknown')}</Notice>
      )}
      {sent ? <Notice kind="good">{t('resent')}</Notice> : null}

      <Button type="submit" variant="solid" disabled={submitting || code.trim() === ''}>
        {action}
      </Button>

      <div className="flex items-center justify-between text-aside">
        {onResend === undefined ? (
          <span />
        ) : (
          <button
            type="button"
            className="text-muted-foreground underline-offset-4 hover:underline disabled:no-underline disabled:opacity-60"
            disabled={wait > 0 || submitting}
            onClick={async () => {
              setSent(false)
              const seconds = await onResend()
              if (seconds === undefined) {
                setSent(true)
                setWait(60)
              } else {
                setWait(seconds)
              }
            }}
          >
            {wait > 0 ? t('resentIn', { seconds: wait }) : t('resend')}
          </button>
        )}

        {onBack === undefined ? null : (
          <button
            type="button"
            className="text-muted-foreground underline-offset-4 hover:underline"
            onClick={onBack}
          >
            {t('back')}
          </button>
        )}
      </div>
    </form>
  )
}
