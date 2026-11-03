import type { ChildProcess } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { legalDocument } from '../content/legal/index.ts'
import { LOCALE_COOKIE } from '../i18n/locales.ts'
import { isBuilt, requireBuild, startNext } from './server.ts'

const PORT = 3178
const ORIGIN = `http://localhost:${PORT}`

requireBuild()

let server: ChildProcess | undefined

async function page(path: string, locale?: string): Promise<{ status: number; html: string }> {
  const response = await fetch(`${ORIGIN}${path}`, {
    headers: locale === undefined ? {} : { cookie: `${LOCALE_COOKIE}=${locale}` },
  })
  return { status: response.status, html: await response.text() }
}

beforeAll(async () => {
  if (isBuilt) {
    server = await startNext(PORT)
  }
}, 60_000)

afterAll(() => {
  server?.kill()
})

describe.skipIf(!isBuilt)('the legal pages', () => {
  it.each(['/legal/terms', '/legal/privacy'])('serves %s', async (path) => {
    expect((await page(path)).status).toBe(200)
  })

  it('answers 404 for a document that does not exist', async () => {
    expect((await page('/legal/cookies')).status).toBe(404)
  })

  it.each([
    ['pt-BR', 'terms'],
    ['pt-BR', 'privacy'],
    ['es', 'terms'],
    ['es', 'privacy'],
    ['en', 'terms'],
    ['en', 'privacy'],
  ] as const)('serves %s in the language the cookie asks for: %s', async (locale, id) => {
    const document = legalDocument(id, locale)
    const { html } = await page(`/legal/${id}`, locale)

    expect(html).toContain(document.title)
    expect(html).toContain(document.sections[0]?.heading)
  })

  it('carries every clause of the document into the page', async () => {
    const document = legalDocument('privacy', 'pt-BR')
    const { html } = await page('/legal/privacy', 'pt-BR')

    for (const section of document.sections) {
      expect(html, `the page dropped the section "${section.id}"`).toContain(section.heading)
      for (const text of [...section.paragraphs, ...(section.items ?? [])]) {
        expect(html, `the page dropped a clause of "${section.id}"`).toContain(text)
      }
    }
  })

  it('links one document to the other, so neither is a dead end', async () => {
    expect((await page('/legal/terms')).html).toContain('/legal/privacy')
    expect((await page('/legal/privacy')).html).toContain('/legal/terms')
  })

  it('reaches both from the home page', async () => {
    const { html } = await page('/')

    expect(html).toContain('/legal/terms')
    expect(html).toContain('/legal/privacy')
  })

  it('shows the day the document says, in every time zone west of UTC', async () => {
    const { html } = await page('/legal/terms', 'pt-BR')

    expect(legalDocument('terms', 'pt-BR').updated).toBe('2026-11-03')
    expect(html, 'the date was formatted in local time and slid a day back').toContain(
      '3 de novembro de 2026',
    )
  })
})
