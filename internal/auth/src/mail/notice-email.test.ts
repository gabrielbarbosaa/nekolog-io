import { describe, expect, it } from 'vitest'
import { EMAIL_LOCALES } from './code-email.ts'
import { NOTICES, noticeEmail } from './notice-email.ts'

const SOMEWHERE = { device: 'Firefox on Linux x86_64', country: 'BR', at: 1_762_000_000_000 }

describe('a notice about something that happened to the account', () => {
  it.each(NOTICES)('%s is written in every locale, and never twice the same', (purpose) => {
    const subjects = EMAIL_LOCALES.map(
      (locale) => noticeEmail({ purpose, locale, ...SOMEWHERE }).subject,
    )

    expect(new Set(subjects).size, `${purpose} repeats a subject across locales`).toBe(
      EMAIL_LOCALES.length,
    )
    for (const subject of subjects) {
      expect(subject.trim()).not.toBe('')
    }
  })

  it.each(NOTICES)('%s carries no link at all, which is the whole point', (purpose) => {
    for (const locale of EMAIL_LOCALES) {
      const notice = noticeEmail({ purpose, locale, ...SOMEWHERE })

      expect(notice.html, locale).not.toContain('<a ')
      expect(notice.html, locale).not.toContain('http')
      expect(notice.text, locale).not.toContain('http')
    }
  })

  it('falls back to English for a locale nobody speaks here', () => {
    expect(noticeEmail({ purpose: 'token-reused', locale: 'fr', ...SOMEWHERE }).subject).toBe(
      noticeEmail({ purpose: 'token-reused', locale: 'en', ...SOMEWHERE }).subject,
    )
  })

  it('escapes a browser name that tries to carry markup, and names it unknown', () => {
    const notice = noticeEmail({
      purpose: 'password-changed',
      locale: 'en',
      device: '<img src=x onerror=alert(1)>',
      country: 'BR',
      at: SOMEWHERE.at,
    })

    expect(notice.html).not.toContain('<img')
    expect(notice.html).toContain('unknown')
  })

  it('tells the three notices apart, so one cannot be sent for another', () => {
    const subjects = NOTICES.map(
      (purpose) => noticeEmail({ purpose, locale: 'pt-BR', ...SOMEWHERE }).subject,
    )

    expect(new Set(subjects).size).toBe(NOTICES.length)
  })
})
