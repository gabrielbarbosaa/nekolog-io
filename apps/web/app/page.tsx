import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { SiteHeader } from '@/components/site-header'
import type { Locale } from '@/i18n/locales'
import { CONTACT_URL, docsUrl } from '@/lib/links'

const INSTALL = 'pnpm add @nekolog-io/node'

const SAMPLE = `import { createLogger } from '@nekolog-io/node'

const log = createLogger({ service: 'checkout-api' })

log.error('payment failed', new Error('gateway timeout'))`

const READ_BACK = `curl -H "Authorization: Bearer $NEKOLOG_KEY" \\
  "https://api.nekolog.io/v1/logs?q=level:error&limit=20"`

const FEATURES = ['sdks', 'privacy', 'search', 'issues', 'alerts', 'otlp'] as const
const DATA_POINTS = ['ip', 'client', 'server', 'url'] as const
const NUMBERS = ['deps', 'size', 'cpu', 'runtimes'] as const

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-border bg-card p-4 font-mono text-card-foreground text-sm leading-relaxed">
      <code>{children}</code>
    </pre>
  )
}

export default async function HomePage() {
  const locale = (await getLocale()) as Locale
  const t = await getTranslations('HomePage')
  const legal = await getTranslations('Legal')
  const docs = (path = '') => docsUrl(locale, path)

  return (
    <div className="min-h-svh bg-background text-foreground">
      <SiteHeader />

      <main className="mx-auto max-w-5xl px-6">
        <section className="py-16 sm:py-24">
          <h1 className="max-w-3xl text-balance font-semibold text-4xl tracking-tight sm:text-5xl">
            {t('tagline')}
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground">{t('lede')}</p>
          <p className="mt-4 max-w-2xl rounded-lg border border-border border-dashed px-4 py-3 text-muted-foreground text-sm">
            {t('status')}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={CONTACT_URL}
              prefetch={false}
              className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:opacity-90"
            >
              {t('askForAccess')}
            </Link>
            <Link
              href={docs()}
              prefetch={false}
              className="rounded-md border border-border px-4 py-2 font-medium text-sm hover:bg-accent hover:text-accent-foreground"
            >
              {t('readTheDocs')}
            </Link>
          </div>
        </section>

        <section className="grid gap-8 border-border border-t py-16 md:grid-cols-2">
          <div>
            <h2 className="font-medium text-muted-foreground text-sm uppercase tracking-wide">
              {t('sampleLabel')}
            </h2>
            <div className="mt-4 space-y-3">
              <Code>{INSTALL}</Code>
              <Code>{SAMPLE}</Code>
            </div>
          </div>
          <div>
            <h2 className="font-medium text-muted-foreground text-sm uppercase tracking-wide">
              {t('readLabel')}
            </h2>
            <div className="mt-4">
              <Code>{READ_BACK}</Code>
            </div>
          </div>
        </section>

        <section className="border-border border-t py-16">
          <h2 className="font-semibold text-2xl tracking-tight">{t('features.title')}</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <article key={feature} className="rounded-lg border border-border bg-card p-5">
                <h3 className="font-medium text-card-foreground">
                  {t(`features.${feature}.title`)}
                </h3>
                <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
                  {t(`features.${feature}.body`)}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="border-border border-t py-16">
          <h2 className="font-semibold text-2xl tracking-tight">{t('model.title')}</h2>
          <p className="mt-4 max-w-3xl text-muted-foreground">{t('model.body')}</p>
          <p className="mt-4 max-w-3xl text-muted-foreground">{t('model.line')}</p>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <article className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-medium text-card-foreground">{t('model.yoursTitle')}</h3>
              <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
                {t('model.yoursBody')}
              </p>
            </article>
            <article className="rounded-lg border border-border border-dashed p-5">
              <h3 className="font-medium">{t('model.oursTitle')}</h3>
              <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
                {t('model.oursBody')}
              </p>
            </article>
          </div>
        </section>

        <section className="border-border border-t py-16">
          <h2 className="font-semibold text-2xl tracking-tight">{t('data.title')}</h2>
          <ul className="mt-6 max-w-3xl space-y-4">
            {DATA_POINTS.map((point) => (
              <li key={point} className="text-muted-foreground leading-relaxed">
                {t(`data.${point}`)}
              </li>
            ))}
          </ul>
          <Link
            href={docs('reference/privacy/')}
            prefetch={false}
            className="mt-6 inline-block text-sm underline underline-offset-4 hover:text-foreground"
          >
            {t('data.link')}
          </Link>
        </section>

        <section className="border-border border-t py-16">
          <h2 className="font-semibold text-2xl tracking-tight">{t('numbers.title')}</h2>
          <ul className="mt-6 max-w-3xl space-y-4">
            {NUMBERS.map((number) => (
              <li key={number} className="text-muted-foreground leading-relaxed">
                {t(`numbers.${number}`)}
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-border border-t">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-8 text-muted-foreground text-sm">
          <span className="font-mono">{t('title')}</span>
          <Link href={docs()} prefetch={false} className="hover:text-foreground">
            {t('footer.docs')}
          </Link>
          <Link href={CONTACT_URL} prefetch={false} className="hover:text-foreground">
            {t('footer.contact')}
          </Link>
          <Link href="/legal/terms" className="hover:text-foreground">
            {legal('terms')}
          </Link>
          <Link href="/legal/privacy" className="hover:text-foreground">
            {legal('privacy')}
          </Link>
        </div>
      </footer>
    </div>
  )
}
