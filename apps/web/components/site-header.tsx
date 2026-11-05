import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { DOCS_URL, GITHUB_URL } from '@/lib/links'

export function SiteHeader() {
  const t = useTranslations('HomePage')

  return (
    <header className="sticky top-0 z-10 border-border/60 border-b bg-background/80 backdrop-blur">
      <nav className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-4">
        <Link href="/" className="font-mono font-semibold text-lg tracking-tight">
          {t('title')}
        </Link>
        <div className="ml-auto flex items-center gap-2 sm:gap-4">
          <Link
            href={DOCS_URL}
            className="text-muted-foreground text-sm hover:text-foreground"
            prefetch={false}
          >
            {t('footer.docs')}
          </Link>
          <Link
            href={GITHUB_URL}
            className="text-muted-foreground text-sm hover:text-foreground"
            prefetch={false}
          >
            {t('footer.github')}
          </Link>
          <ThemeToggle />
          <LocaleSwitcher />
        </div>
      </nav>
    </header>
  )
}
