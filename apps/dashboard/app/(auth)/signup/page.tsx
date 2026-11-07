import { MIN_PASSWORD_LENGTH } from '@internal/auth'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { AuthFrame } from '@/components/auth-frame'
import { Notice } from '@/components/field'
import { currentSession } from '@/lib/session'
import { SignUp } from './sign-up'

export const dynamic = 'force-dynamic'

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>
}) {
  if ((await currentSession()) !== undefined) {
    redirect('/')
  }

  const t = await getTranslations('Auth')
  const { invite } = await searchParams

  if (invite === undefined || invite === '') {
    return (
      <AuthFrame title={t('signUpTitle')}>
        <Notice kind="bad">{t('signUpNoInvite')}</Notice>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame title={t('signUpTitle')} body={t('signUpBody')}>
      <SignUp invite={invite} minPassword={MIN_PASSWORD_LENGTH} />
    </AuthFrame>
  )
}
