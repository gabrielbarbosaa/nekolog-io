import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

const SCREENS = [
  'logs',
  'issues',
  'dashboards',
  'alerts',
  'releases',
  'exports',
  'settings',
] as const

export function Sidebar({ current }: { current: (typeof SCREENS)[number] }) {
  const t = useTranslations('Sidebar')

  return (
    <nav
      aria-label={t('label')}
      className="hidden w-56 shrink-0 flex-col border-border border-r bg-sidebar p-2 md:flex"
    >
      <div className="flex items-baseline gap-2 px-2 py-3">
        <span className="font-semibold text-section tracking-tight">NekoLog</span>
      </div>

      <button
        type="button"
        className="mb-3 flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent"
      >
        <span className="truncate font-medium">{t('noProject')}</span>
      </button>

      <ul className="flex flex-col gap-px">
        {SCREENS.map((screen) => (
          <li key={screen}>
            <span
              aria-current={screen === current ? 'page' : undefined}
              className={cn(
                'block rounded-md px-2 py-1 text-muted-foreground',
                screen === current &&
                  'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
              )}
            >
              {t(screen)}
            </span>
          </li>
        ))}
      </ul>
    </nav>
  )
}
