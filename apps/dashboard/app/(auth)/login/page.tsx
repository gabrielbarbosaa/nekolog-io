import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { AuthFrame } from '@/components/auth-frame'
import { Notice } from '@/components/field'
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

  return (
    <AuthFrame title={t('signInTitle')} body={t('signInBody')}>
      <SignIn />
    </AuthFrame>
  )
}
