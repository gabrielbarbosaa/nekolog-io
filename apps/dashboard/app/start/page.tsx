import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { SignOut } from '@/components/sign-out'
import { ThemeToggle } from '@/components/theme-toggle'
import { signedIn } from '@/lib/workspace'
import { NewOrganization } from './new-organization'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const signed = await signedIn()
  const first = signed.organizations[0]
  if (first !== undefined) {
    redirect(`/${first.id}/projects`)
  }

  const t = await getTranslations('Projects')

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-5 py-4">
        <span className="font-semibold text-section tracking-tight">NekoLog</span>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 px-5 pt-[8vh]">
        <div className="mx-auto w-full max-w-sm">
          <h1 className="font-semibold text-screen tracking-tight">{t('createOrganization')}</h1>
          <p className="mt-1.5 text-muted-foreground">{t('noOrganization')}</p>

          <div className="mt-7">
            <NewOrganization />
          </div>

          <div className="mt-8 w-40 border-border border-t pt-3">
            <SignOut />
          </div>
        </div>
      </main>
    </div>
  )
}
