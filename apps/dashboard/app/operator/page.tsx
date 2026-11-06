import { isOperator } from '@internal/auth'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Wordmark } from '@/components/logo'
import { loginDeps } from '@/lib/auth'
import { unlocked } from '@/lib/operator'
import { currentSession } from '@/lib/session'
import { signedIn } from '@/lib/workspace'
import { OperatorArea } from './operator-area'
import { Unlock } from './unlock'

export const dynamic = 'force-dynamic'

export default async function Page() {
  await signedIn()

  const claims = await currentSession()
  if (claims === undefined || !(await isOperator(loginDeps().run, claims.sub))) {
    notFound()
  }

  const t = await getTranslations('Operator')
  const open = await unlocked(claims.sid)

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-border border-b px-4">
        <Wordmark />
        <span className="text-muted-foreground">{t('title')}</span>
      </header>

      <main className="flex-1 px-5 py-7 md:px-7">{open ? <OperatorArea /> : <Unlock />}</main>
    </div>
  )
}
