import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { AuthFrame } from '@/components/auth-frame'
import { currentSession } from '@/lib/session'
import { SignIn } from './sign-in'

export const dynamic = 'force-dynamic'

export default async function Page() {
  if ((await currentSession()) !== undefined) {
    redirect('/')
  }

  const t = await getTranslations('Auth')

  return (
    <AuthFrame title={t('signInTitle')} body={t('signInBody')}>
      <SignIn />
    </AuthFrame>
  )
}
