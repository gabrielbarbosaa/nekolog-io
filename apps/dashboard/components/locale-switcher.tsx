'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useTransition } from 'react'
import { setLocale } from '@/app/actions'
import { Button } from '@/components/button'
import { locales } from '@/i18n/locales'

export function LocaleSwitcher() {
  const locale = useLocale()
  const t = useTranslations('LocaleSwitcher')
  const [isPending, startTransition] = useTransition()

  return (
    <fieldset className="flex items-center rounded-md border border-border">
      <legend className="sr-only">{t('label')}</legend>
      {locales.map((value) => (
        <Button
          key={value}
          variant={value === locale ? 'solid' : 'quiet'}
          aria-pressed={value === locale}
          disabled={isPending}
          onClick={() => startTransition(() => setLocale(value))}
        >
          {value}
        </Button>
      ))}
    </fieldset>
  )
}
