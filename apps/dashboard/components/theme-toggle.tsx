'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Button } from '@/components/button'

const OPTIONS = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
] as const

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const t = useTranslations('ThemeToggle')
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  return (
    <fieldset className="flex items-center rounded-md border border-border">
      <legend className="sr-only">{t('label')}</legend>
      {OPTIONS.map(({ value, icon: Icon }) => (
        <Button
          key={value}
          variant={mounted && theme === value ? 'solid' : 'quiet'}
          size="icon"
          aria-label={t(value)}
          aria-pressed={mounted && theme === value}
          onClick={() => setTheme(value)}
        >
          <Icon />
        </Button>
      ))}
    </fieldset>
  )
}
