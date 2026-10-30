'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useTransition } from 'react'
import { setLocale } from '@/app/actions'
import { Button } from '@/components/ui/button'
import { locales } from '@/i18n/locales'

export function LocaleSwitcher() {
  const locale = useLocale()
  const t = useTranslations('LocaleSwitcher')
  const [isPending, startTransition] = useTransition()

  return (
    <div className="flex items-center gap-1">
      <span className="sr-only">{t('label')}</span>
      {locales.map((value) => (
        <Button
          key={value}
          variant={value === locale ? 'default' : 'outline'}
          size="sm"
          disabled={isPending}
          onClick={() => startTransition(() => setLocale(value))}
        >
          {value}
        </Button>
      ))}
    </div>
  )
}
