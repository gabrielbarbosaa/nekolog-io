import { findDemoAccount } from '@internal/auth'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { AuthFrame } from '@/components/auth-frame'
import { Notice } from '@/components/field'
import { loginDeps } from '@/lib/auth'
import { readiness } from '@/lib/readiness'
import { currentSession } from '@/lib/session'
import { SignIn } from './sign-in'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const state = await readiness()
  const t = await getTranslations('Auth')

  if (!state.ready) {
    return (
      <AuthFrame title={t('signInTitle')}>
        <Notice kind="bad">{state.detail}</Notice>
      </AuthFrame>
    )
  }

  if ((await currentSession()) !== undefined) {
    redirect('/')
  }

  const demo = await getTranslations('Demo')
  const open = (await findDemoAccount(loginDeps().run)) !== undefined

  return (
    <AuthFrame title={t('signInTitle')} body={t('signInBody')}>
      <SignIn />

      {open ? (
        <p className="mt-6 border-border border-t pt-4 text-aside text-muted-foreground">
          <Link href="/demo" className="underline underline-offset-4 hover:text-foreground">
            {demo('enter')}
          </Link>{' '}
          {demo('noAccountNeeded')}
        </p>
      ) : null}
    </AuthFrame>
  )
}
