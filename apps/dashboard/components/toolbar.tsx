import { Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { ThemeToggle } from '@/components/theme-toggle'

export function Toolbar() {
  const t = useTranslations('Toolbar')

  return (
    <header className="flex h-12 items-center gap-3 border-border border-b px-3">
      <div className="flex min-w-0 flex-1 items-center gap-px rounded-md border border-border">
        <span className="flex items-center gap-1.5 px-2.5 py-1.5 text-muted-foreground">
          <span aria-hidden className="size-1.5 rounded-full bg-env-production" />
          production
        </span>
        <span className="h-5 w-px bg-border" />
        <span className="px-2.5 py-1.5 text-muted-foreground">{t('period')}</span>
        <span className="h-5 w-px bg-border" />
        <span className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5">
          <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-muted-foreground">{t('searchHint')}</span>
        </span>
      </div>

      <div className="flex items-center gap-2">
        <LocaleSwitcher />
        <ThemeToggle />
      </div>
    </header>
  )
}
