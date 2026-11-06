import { findDemoAccount } from '@internal/auth'
import { getTranslations } from 'next-intl/server'
import { AuthFrame } from '@/components/auth-frame'
import { Notice } from '@/components/field'
import { loginDeps } from '@/lib/auth'
import { readiness } from '@/lib/readiness'
import { EnterTheDemo } from './enter'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const t = await getTranslations('Demo')
  const state = await readiness()

  if (!state.ready) {
    return (
      <AuthFrame title={t('title')}>
        <Notice kind="bad">{state.detail}</Notice>
      </AuthFrame>
    )
  }

  const demo = await findDemoAccount(loginDeps().run)

  return (
    <AuthFrame title={t('title')} body={t('body')}>
      {demo === undefined ? (
        <Notice kind="bad">{t('unavailable')}</Notice>
      ) : (
        <EnterTheDemo organization={demo.organization} />
      )}
    </AuthFrame>
  )
}
