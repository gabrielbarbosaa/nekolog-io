import { findAccountById, MIN_PASSWORD_LENGTH } from '@internal/auth'
import { getTranslations } from 'next-intl/server'
import { Shell } from '@/components/shell'
import { loginDeps } from '@/lib/auth'
import { signedIn } from '@/lib/workspace'
import { ChangePassword, Sessions } from './account-panel'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const signed = await signedIn()
  const account = await findAccountById(loginDeps().run, signed.userId)
  const organization = signed.organizations[0]
  const t = await getTranslations('Account')

  const body = (
    <div className="max-w-3xl">
      <h1 className="font-semibold text-screen tracking-tight">{t('title')}</h1>

      <dl className="mt-6 flex flex-col gap-2">
        <div className="flex gap-3">
          <dt className="w-24 shrink-0 text-muted-foreground">{t('profile')}</dt>
          <dd>{account?.name ?? ''}</dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-24 shrink-0 text-muted-foreground">{t('email')}</dt>
          <dd className="font-mono">{account?.email ?? ''}</dd>
        </div>
      </dl>

      <section className="mt-10">
        <h2 className="font-semibold text-section tracking-tight">{t('security')}</h2>
        <ChangePassword minPassword={MIN_PASSWORD_LENGTH} />
      </section>

      <Sessions />
    </div>
  )

  if (organization === undefined) {
    return <div className="px-5 py-7 md:px-7">{body}</div>
  }

  return (
    <Shell place={{ organization }} current="account">
      {body}
    </Shell>
  )
}
