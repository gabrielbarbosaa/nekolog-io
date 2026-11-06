import type { Organization, Project } from '@internal/auth'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { Wordmark } from '@/components/logo'
import { SignOut } from '@/components/sign-out'
import { ThemeToggle } from '@/components/theme-toggle'
import { cn } from '@/lib/utils'

export type Place = {
  organization: Organization
  project?: Project | undefined
}

const PROJECT_SCREENS = ['issues', 'dashboards', 'alerts', 'releases', 'exports'] as const

export async function Shell({
  place,
  current,
  bare,
  children,
}: {
  place: Place
  current: string
  bare?: boolean
  children: ReactNode
}) {
  const t = await getTranslations('Sidebar')
  const org = `/${place.organization.id}`
  const project = place.project === undefined ? undefined : `${org}/${place.project.id}`

  return (
    <div className={cn('flex', bare ? 'h-dvh overflow-hidden' : 'min-h-dvh')}>
      <nav
        aria-label={t('label')}
        className="hidden w-56 shrink-0 flex-col border-border border-r bg-sidebar p-2 md:flex"
      >
        <Link href="/" className="px-2 py-3">
          <Wordmark />
        </Link>

        <Link
          href={`${org}/projects`}
          className="mb-3 flex min-w-0 flex-col rounded-md px-2 py-1.5 hover:bg-sidebar-accent"
        >
          <span className="truncate font-medium">{place.project?.name ?? t('noProject')}</span>
          <span className="truncate text-aside text-muted-foreground">
            {place.organization.name}
          </span>
        </Link>

        <ul className="flex flex-col gap-px">
          {project === undefined ? null : (
            <Item href={`${project}/logs`} current={current} name="logs">
              {t('logs')}
            </Item>
          )}

          {project === undefined
            ? null
            : PROJECT_SCREENS.map((screen) => (
                <li key={screen}>
                  <span
                    aria-disabled
                    title={t('comingLater')}
                    className="block rounded-md px-2 py-1 text-muted-foreground/50"
                  >
                    {t(screen)}
                  </span>
                </li>
              ))}

          {project === undefined ? null : (
            <Item href={`${project}/settings`} current={current} name="project-settings">
              {t('settings')}
            </Item>
          )}
        </ul>

        <ul className="mt-auto flex flex-col gap-px border-border border-t pt-2">
          <Item href={`${org}/projects`} current={current} name="projects">
            {t('projects')}
          </Item>
          <Item href={`${org}/members`} current={current} name="members">
            {t('members')}
          </Item>
          <Item href="/account" current={current} name="account">
            {t('account')}
          </Item>
          <li>
            <SignOut />
          </li>
        </ul>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center justify-end gap-2 border-border border-b px-3">
          <LocaleSwitcher />
          <ThemeToggle />
        </header>

        <main className={cn(bare ? 'min-h-0 flex-1' : 'flex-1 px-5 py-7 md:px-7')}>{children}</main>
      </div>
    </div>
  )
}

function Item({
  href,
  current,
  name,
  children,
}: {
  href: string
  current: string
  name: string
  children: ReactNode
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={name === current ? 'page' : undefined}
        className={cn(
          'block rounded-md px-2 py-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground',
          name === current && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
        )}
      >
        {children}
      </Link>
    </li>
  )
}
