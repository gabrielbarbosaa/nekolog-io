import { describe, expect, it } from 'vitest'
import { EMAIL_LOCALES } from './code-email.ts'
import { inviteEmail, inviteLink } from './invite-email.ts'

const TOKEN = 'rJ8vQx2mB4nT7kLpZ0aWcEuYhSgDfI1o'

const NOTICE = {
  organization: 'Acme Widgets',
  inviter: 'Ana Maria',
  appUrl: 'https://dash.nekolog.io',
  token: TOKEN,
  days: 7,
}

describe('the link an invitation carries', () => {
  it('is built from the origin only, so a path in the variable cannot move it', () => {
    expect(inviteLink('https://dash.nekolog.io/some/where?x=1', TOKEN)).toBe(
      `https://dash.nekolog.io/signup?invite=${TOKEN}`,
    )
  })

  it('works on localhost, which is what development is', () => {
    expect(inviteLink('http://localhost:3001', TOKEN)).toBe(
      `http://localhost:3001/signup?invite=${TOKEN}`,
    )
  })

  it('refuses anything that is not a token, so nothing else reaches the query', () => {
    for (const broken of ['', 'short', `${TOKEN}&next=//evil.test`, `${TOKEN}"`, '../../etc']) {
      expect(() => inviteLink('https://dash.nekolog.io', broken), broken).toThrow(
        /not an invite token/,
      )
    }
  })

  it('refuses a base that is not the web', () => {
    expect(() => inviteLink('javascript:alert(1)', TOKEN)).toThrow()
    expect(() => inviteLink('ftp://dash.nekolog.io', TOKEN)).toThrow(/cannot be built/)
  })
})

describe('the message itself', () => {
  it('is written in every locale, and never twice the same', () => {
    const subjects = EMAIL_LOCALES.map((locale) => inviteEmail({ ...NOTICE, locale }).subject)

    expect(new Set(subjects).size).toBe(EMAIL_LOCALES.length)
    for (const subject of subjects) {
      expect(subject).toContain('Acme Widgets')
    }
  })

  it('escapes an organization name somebody typed, in the subject and in the body', () => {
    const message = inviteEmail({
      ...NOTICE,
      locale: 'en',
      organization: '<img src=x onerror=alert(1)>',
      inviter: '</p><script>alert(2)</script>',
    })

    expect(message.html).not.toContain('<img')
    expect(message.html).not.toContain('<script')
    expect(message.html).toContain('&lt;img')
  })

  it('carries exactly one link, and it is the invitation', () => {
    const message = inviteEmail({ ...NOTICE, locale: 'pt-BR' })
    const addresses = [...message.html.matchAll(/href="([^"]+)"/g)].map((match) => match[1])

    expect(addresses).toEqual([`https://dash.nekolog.io/signup?invite=${TOKEN}`])
  })

  it('says how long it lasts, with the number it was given', () => {
    expect(inviteEmail({ ...NOTICE, locale: 'en', days: 7 }).text).toContain('7 days')
  })

  it('falls back to English for a locale nobody speaks here', () => {
    expect(inviteEmail({ ...NOTICE, locale: 'fr' }).subject).toBe(
      inviteEmail({ ...NOTICE, locale: 'en' }).subject,
    )
  })
})
