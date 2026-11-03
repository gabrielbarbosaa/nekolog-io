import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { defaultLocale, locales } from '../../i18n/locales'
import { isLegalDocumentId, type LegalDocument, legalDocumentIds } from './document'
import { legalDocument, legalDocuments } from './index'

const translated = locales.filter((locale) => locale !== defaultLocale)

function texts(document: LegalDocument): string[] {
  return [
    document.title,
    document.summary,
    ...document.sections.flatMap((section) => [
      section.heading,
      ...section.paragraphs,
      ...(section.items ?? []),
    ]),
  ]
}

describe('every legal document exists in every locale', () => {
  it.each(locales)('%s has all of them', (locale) => {
    for (const id of legalDocumentIds) {
      expect(legalDocuments[locale][id].id).toBe(id)
    }
  })

  it('renders the text as text, never as HTML', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../app/legal/[document]/page.tsx', import.meta.url)),
      'utf8',
    )

    expect(source).not.toContain('dangerouslySetInnerHTML')
  })

  it('knows which paths are documents and which are not', () => {
    expect(legalDocumentIds.every(isLegalDocumentId)).toBe(true)
    expect(isLegalDocumentId('cookies')).toBe(false)
    expect(isLegalDocumentId('')).toBe(false)
  })
})

describe.each(legalDocumentIds)('%s, across the three locales', (id) => {
  const source = legalDocument(id, defaultLocale)

  it('keeps the same sections, in the same order', () => {
    const expected = source.sections.map((section) => section.id)

    expect(expected.length).toBeGreaterThan(0)
    for (const locale of translated) {
      expect(
        legalDocument(id, locale).sections.map((section) => section.id),
        `${locale} does not follow ${defaultLocale}`,
      ).toEqual(expected)
    }
  })

  it.each(translated)('loses no clause in %s', (locale) => {
    const other = legalDocument(id, locale)

    for (const [index, section] of source.sections.entries()) {
      const mirror = other.sections[index]
      expect(
        mirror?.paragraphs.length,
        `${locale}: section "${section.id}" has a different number of paragraphs`,
      ).toBe(section.paragraphs.length)
      expect(
        mirror?.items?.length ?? 0,
        `${locale}: section "${section.id}" has a different number of items`,
      ).toBe(section.items?.length ?? 0)
    }
  })

  it('carries the same date in every locale, so none quietly lags behind', () => {
    for (const locale of translated) {
      expect(legalDocument(id, locale).updated).toBe(source.updated)
    }
    expect(source.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it.each(locales)('writes nothing blank in %s', (locale) => {
    const blank = texts(legalDocument(id, locale)).filter((text) => text.trim() === '')

    expect(blank).toEqual([])
  })

  it.each(locales)('gives every section something to say in %s', (locale) => {
    for (const section of legalDocument(id, locale).sections) {
      expect(
        section.paragraphs.length + (section.items?.length ?? 0),
        `section "${section.id}" is empty`,
      ).toBeGreaterThan(0)
    }
  })

  it.each(translated)('is not the English text pasted into %s', (locale) => {
    const sentences = new Set(texts(source).filter((text) => text.length > 40))
    const shared = texts(legalDocument(id, locale)).filter((text) => sentences.has(text))

    expect(shared, `${locale} repeats the source text: ${shared.join(' | ')}`).toEqual([])
  })

  it('says where to write, in every locale', () => {
    for (const locale of locales) {
      expect(texts(legalDocument(id, locale)).join(' ')).toContain('contato@nekolog.io')
    }
  })
})
