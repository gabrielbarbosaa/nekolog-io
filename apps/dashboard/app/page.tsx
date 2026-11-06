import { getTranslations } from 'next-intl/server'
import { Sidebar } from '@/components/sidebar'
import { Toolbar } from '@/components/toolbar'
import { currentSession } from '@/lib/session'

const WIRED = ['theme', 'locale', 'headers', 'health'] as const

export default async function Page() {
  const t = await getTranslations('Foundation')
  const claims = await currentSession()

  return (
    <div className="flex min-h-dvh">
      <Sidebar current="logs" />

      <div className="flex min-w-0 flex-1 flex-col">
        <Toolbar />

        <main className="flex-1 px-6 py-10">
          <div className="max-w-prose">
            <h1 className="font-semibold text-screen tracking-tight">{t('title')}</h1>
            <p className="mt-2 text-muted-foreground">{t('body')}</p>

            <dl className="mt-8 flex flex-col gap-2 border-border border-t pt-6">
              {WIRED.map((item) => (
                <div key={item} className="flex gap-3">
                  <dt className="w-24 shrink-0 text-muted-foreground">{t(`${item}.name`)}</dt>
                  <dd>{t(`${item}.state`)}</dd>
                </div>
              ))}

              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-muted-foreground">{t('session.name')}</dt>
                <dd>{claims === undefined ? t('session.out') : t('session.in')}</dd>
              </div>
            </dl>

            <p className="mt-8 text-aside text-muted-foreground">{t('next')}</p>
          </div>
        </main>
      </div>
    </div>
  )
}
