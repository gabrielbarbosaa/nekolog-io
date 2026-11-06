import { describe, expect, it } from 'vitest'
import {
  codeEmail,
  describeCountry,
  describeDevice,
  EMAIL_LOCALES,
  type EmailLocale,
  localeFor,
} from './code-email.ts'

const NOTICE = {
  purpose: 'login' as const,
  code: 'K7QM2P',
  locale: 'en',
  device: 'Firefox on Linux',
  country: 'BR',
  at: Date.UTC(2026, 10, 6, 14, 52),
}

describe('the code e-mail', () => {
  it('shows the code grouped, the way the screen asks for it', () => {
    const mail = codeEmail(NOTICE)

    expect(mail.html).toContain('K7Q-M2P')
    expect(mail.text).toContain('K7Q-M2P')
  })

  it('carries no link at all, because a link that signs you in is the attack', () => {
    const mail = codeEmail(NOTICE)

    expect(mail.html).not.toContain('<a ')
    expect(mail.html).not.toContain('http')
    expect(mail.text).not.toContain('http')
  })

  it('says what to do if it was not you', () => {
    expect(codeEmail(NOTICE).text).toContain('change your password')
  })

  it('names the browser, the country and the time, as section 11.6 asks', () => {
    const mail = codeEmail(NOTICE)

    expect(mail.text).toContain('Firefox on Linux')
    expect(mail.text).toContain('BR')
    expect(mail.text).toContain('2026-11-06 14:52')
  })

  it('exists in all three languages, each one different', () => {
    const subjects = EMAIL_LOCALES.map((locale) => codeEmail({ ...NOTICE, locale }).subject)

    expect(new Set(subjects).size).toBe(EMAIL_LOCALES.length)
    for (const locale of EMAIL_LOCALES) {
      const mail = codeEmail({ ...NOTICE, locale })
      expect(mail.html, locale).toContain('K7Q-M2P')
      expect(mail.subject.trim(), locale).not.toBe('')
    }
  })

  it('falls back to English for a language it does not have', () => {
    expect(localeFor('fr')).toBe('en')
    expect(localeFor(undefined)).toBe('en')
    expect(codeEmail({ ...NOTICE, locale: 'fr' }).subject).toBe(
      codeEmail({ ...NOTICE, locale: 'en' }).subject,
    )
  })
})

describe('what the e-mail refuses to repeat', () => {
  it('replaces a browser string that is not one', () => {
    expect(describeDevice('<script>alert(1)</script>')).toBe('unknown')
    expect(describeDevice('Firefox on Linux')).toBe('Firefox on Linux')
  })

  it('keeps the shapes a real user agent actually produces', () => {
    for (const device of [
      'Firefox on Linux x86_64',
      'Chrome on Windows NT 10.0',
      'Safari on Macintosh',
      'Edg on Windows NT 10.0',
    ]) {
      expect(describeDevice(device), device).toBe(device)
    }
  })

  it('replaces a country that is not two letters', () => {
    expect(describeCountry('Brazil')).toBe('??')
    expect(describeCountry('br')).toBe('??')
    expect(describeCountry('BR')).toBe('BR')
  })

  it('escapes anyway, so the refusal is not the only thing standing there', () => {
    const mail = codeEmail({ ...NOTICE, device: 'Firefox (Linux)', country: 'ZZ' })

    expect(mail.html).toContain('Firefox (Linux)')
    expect(mail.html).not.toContain('<script')
  })

  it('never repeats the e-mail address or a name back', () => {
    const mail = codeEmail(NOTICE)

    expect(mail.html).not.toContain('@')
    expect(mail.text).not.toContain('@')
  })
})

describe('the locale list', () => {
  it('is the three the project ships', () => {
    expect([...EMAIL_LOCALES]).toEqual<EmailLocale[]>(['en', 'pt-BR', 'es'])
  })
})
