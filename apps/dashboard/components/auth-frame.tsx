import type { ReactNode } from 'react'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { ThemeToggle } from '@/components/theme-toggle'

export function AuthFrame({
  title,
  body,
  children,
  under,
}: {
  title: string
  body?: string
  children: ReactNode
  under?: ReactNode
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-5 py-4">
        <span className="font-semibold text-section tracking-tight">NekoLog</span>
        <div className="flex items-center gap-1">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-5 pt-[8vh] pb-16">
        <div className="w-full max-w-sm">
          <h1 className="font-semibold text-screen tracking-tight">{title}</h1>
          {body === undefined ? null : <p className="mt-1.5 text-muted-foreground">{body}</p>}

          <div className="mt-7">{children}</div>

          {under === undefined ? null : (
            <div className="mt-6 border-border border-t pt-4 text-aside">{under}</div>
          )}
        </div>
      </main>
    </div>
  )
}
