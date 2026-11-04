import type { ExportNotice } from '@nekolog-io/adapters'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EMAIL_LOCALE,
  EMAIL_LOCALES,
  escapeHtml,
  exportReadyEmail,
  exportUrl,
  localeFor,
} from './export-ready.ts'

const DASHBOARD = 'https://app.nekolog.io'
const EXPORT_ID = 'exp_01JBQ8R4T7V2WXYZ0123456789'

function notice(overrides: Partial<ExportNotice> = {}): ExportNotice {
  return {
    id: EXPORT_ID,
    format: 'csv',
    cadence: 'daily',
    rangeFrom: Date.UTC(2026, 10, 3),
    rangeTo: Date.UTC(2026, 10, 4),
    rowCount: 12_345,
    byteSize: 2_097_152,
    expiresAt: Date.UTC(2026, 10, 11),
    locale: 'pt-BR',
    email: 'reader@example.com',
    ...overrides,
  }
}

describe('the locales it ships in', () => {
  it('is the three the user table allows, falling back to English', () => {
    expect([...EMAIL_LOCALES]).toEqual(['en', 'pt-BR', 'es'])
    expect(DEFAULT_EMAIL_LOCALE).toBe('en')
    expect(localeFor('pt-BR')).toBe('pt-BR')
    expect(localeFor('fr')).toBe('en')
    expect(localeFor('')).toBe('en')
  })

  it('writes a different subject and body in each one', () => {
    const subjects = EMAIL_LOCALES.map((locale) => exportReadyEmail(notice({ locale }), DASHBOARD))

    expect(new Set(subjects.map((one) => one.subject)).size).toBe(EMAIL_LOCALES.length)
    expect(new Set(subjects.map((one) => one.text)).size).toBe(EMAIL_LOCALES.length)
  })

  it('leaves no English sentence inside a translation', () => {
    for (const locale of ['pt-BR', 'es'] as const) {
      const email = exportReadyEmail(notice({ locale }), DASHBOARD)

      expect(email.text).not.toContain('Your log export is ready')
      expect(email.text).not.toContain('Open the export')
      expect(email.text).not.toContain('The file is not attached')
    }
  })

  it('names the cadence in the subject, in the reader language', () => {
    expect(
      exportReadyEmail(notice({ locale: 'pt-BR', cadence: 'weekly' }), DASHBOARD).subject,
    ).toContain('semanal')
    expect(
      exportReadyEmail(notice({ locale: 'en', cadence: 'weekly' }), DASHBOARD).subject,
    ).toContain('weekly')
  })

  it('still writes a subject for an export that came from no schedule', () => {
    const email = exportReadyEmail(notice({ cadence: null }), DASHBOARD)

    expect(email.subject.length).toBeGreaterThan(0)
    expect(email.subject).not.toContain('undefined')
  })
})

describe('the link', () => {
  it('points at the export in the dashboard', () => {
    expect(exportUrl(DASHBOARD, EXPORT_ID)).toBe(`${DASHBOARD}/exports/${EXPORT_ID}`)
  })

  it('does not double the slash when the base carries one', () => {
    expect(exportUrl(`${DASHBOARD}///`, EXPORT_ID)).toBe(`${DASHBOARD}/exports/${EXPORT_ID}`)
  })

  it('refuses anything that is not an https address', () => {
    for (const base of ['http://app.nekolog.io', 'javascript:alert(1)', 'app.nekolog.io', '']) {
      expect(() => exportUrl(base, EXPORT_ID)).toThrow(/Refusing/)
    }
  })

  it('refuses an id that is not one of ours, so nothing is smuggled into the href', () => {
    for (const id of ['../../admin', 'exp_short', '"><script>', '']) {
      expect(() => exportUrl(DASHBOARD, id)).toThrow(/Refusing/)
    }
  })
})

describe('escaping', () => {
  it('turns every character that could open a tag or close an attribute', () => {
    expect(escapeHtml(`<a href="x" title='y'>&`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;',
    )
  })

  it('escapes the ampersand first, so nothing is escaped twice', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })
})

describe('the message', () => {
  it('carries the facts a reader needs and nothing they typed', () => {
    const email = exportReadyEmail(notice(), DASHBOARD)

    expect(email.text).toContain('2026-11-03')
    expect(email.text).toContain('2026-11-04')
    expect(email.text).toContain('12,345')
    expect(email.text).toContain('2.0 MB')
    expect(email.text).toContain('2026-11-11')
    expect(email.text).toContain(`${DASHBOARD}/exports/${EXPORT_ID}`)
  })

  it('never attaches the file, and says why', () => {
    const email = exportReadyEmail(notice({ locale: 'en' }), DASHBOARD)

    expect(email.text).toContain('not attached')
    expect(email.html).not.toContain('attachment')
  })

  it('writes both a text and an html part, and the html is a whole document', () => {
    const email = exportReadyEmail(notice(), DASHBOARD)

    expect(email.html.startsWith('<!doctype html>')).toBe(true)
    expect(email.html).toContain(`href="${DASHBOARD}/exports/${EXPORT_ID}"`)
    expect(email.text.length).toBeGreaterThan(0)
  })

  it('counts bytes in units a person reads', () => {
    expect(exportReadyEmail(notice({ byteSize: 900 }), DASHBOARD).text).toContain('900 B')
    expect(exportReadyEmail(notice({ byteSize: 2048 }), DASHBOARD).text).toContain('2.0 kB')
  })
})
