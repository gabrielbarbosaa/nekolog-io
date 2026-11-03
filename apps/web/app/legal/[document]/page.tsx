import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { legalDocument } from '@/content/legal'
import { isLegalDocumentId, legalDocumentIds } from '@/content/legal/document'
import type { Locale } from '@/i18n/locales'

type Props = { params: Promise<{ document: string }> }

export function generateStaticParams() {
  return legalDocumentIds.map((document) => ({ document }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { document } = await params
  if (!isLegalDocumentId(document)) {
    return {}
  }
  const locale = (await getLocale()) as Locale
  const { title, summary } = legalDocument(document, locale)
  return { title: `${title} — NekoLog`, description: summary }
}

export default async function LegalPage({ params }: Props) {
  const { document } = await params
  if (!isLegalDocumentId(document)) {
    notFound()
  }

  const locale = (await getLocale()) as Locale
  const t = await getTranslations('Legal')
  const { title, summary, updated, sections } = legalDocument(document, locale)
  const updatedOn = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${updated}T00:00:00Z`),
  )

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link href="/" className="text-muted-foreground text-sm hover:text-foreground">
        {t('backHome')}
      </Link>

      <header className="mt-8 space-y-3">
        <h1 className="font-mono text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{summary}</p>
        <p className="text-muted-foreground text-sm">{t('updated', { date: updatedOn })}</p>
      </header>

      <div className="mt-12 space-y-10">
        {sections.map((section) => (
          <section key={section.id} id={section.id} className="space-y-3">
            <h2 className="font-semibold text-xl tracking-tight">{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="text-muted-foreground leading-relaxed">
                {paragraph}
              </p>
            ))}
            {section.items ? (
              <ul className="list-disc space-y-2 pl-6 text-muted-foreground leading-relaxed">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>

      <nav className="mt-16 border-t pt-6 text-sm">
        <Link
          href={document === 'terms' ? '/legal/privacy' : '/legal/terms'}
          className="text-muted-foreground hover:text-foreground"
        >
          {document === 'terms' ? t('privacy') : t('terms')}
        </Link>
      </nav>
    </main>
  )
}
