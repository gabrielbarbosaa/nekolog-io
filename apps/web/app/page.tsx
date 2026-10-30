import { useTranslations } from 'next-intl'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { ThemeToggle } from '@/components/theme-toggle'

export default function HomePage() {
  const t = useTranslations('HomePage')

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="flex items-center gap-4">
        <ThemeToggle />
        <LocaleSwitcher />
      </div>
      <div className="space-y-2">
        <h1 className="font-mono text-4xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('tagline')}</p>
        <p className="text-muted-foreground text-sm">{t('comingSoon')}</p>
      </div>
    </main>
  )
}
