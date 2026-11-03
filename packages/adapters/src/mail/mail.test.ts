import { describe, expect, it } from 'vitest'
import type { EmailMessage, Mailer } from '../mailer.ts'
import type { FetchLike, HttpResponseLike } from '../redis/upstash-redis.ts'
import { assertMessage, EmailRefused, MAX_SUBJECT_CHARS } from './address.ts'
import { allowedBy, allowlistedMailer, parseAllowlist } from './allowlist.ts'
import { memoryMailer } from './memory-mailer.ts'
import { ResendError, resendMailer } from './resend-mailer.ts'
import { type SmtpEnvelope, smtpMailer } from './smtp-mailer.ts'

function message(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    to: 'ada@example.com',
    subject: 'Your code',
    html: '<p>123456</p>',
    ...overrides,
  }
}

describe('what a message has to be before it leaves', () => {
  it('lowercases and trims the recipient, so one address is one address', () => {
    expect(assertMessage(message({ to: '  Ada@Example.COM ' })).to).toBe('ada@example.com')
  })

  it.each([
    ['a newline in the recipient', { to: 'ada@example.com\nbcc: evil@example.com' }],
    ['a carriage return in the recipient', { to: 'ada@example.com\r\nbcc: evil@example.com' }],
    ['a newline in the subject', { subject: 'Your code\nbcc: evil@example.com' }],
    ['a null byte in the recipient', { to: 'ada@example.com\0' }],
  ])('refuses %s, which would forge a header', (_name, overrides) => {
    expect(() => assertMessage(message(overrides))).toThrow(EmailRefused)
  })

  it.each([
    ['no at sign', 'ada.example.com'],
    ['no domain dot', 'ada@example'],
    ['a display name', 'Ada <ada@example.com>'],
    ['two addresses', 'ada@example.com, evil@example.com'],
    ['nothing', ''],
  ])('refuses %s as a recipient', (_name, to) => {
    expect(() => assertMessage(message({ to }))).toThrow(EmailRefused)
  })

  it('refuses an empty subject and an empty body', () => {
    expect(() => assertMessage(message({ subject: '   ' }))).toThrow(/subject is empty/)
    expect(() => assertMessage(message({ html: '' }))).toThrow(/body is empty/)
  })

  it('refuses a subject longer than the limit', () => {
    expect(() => assertMessage(message({ subject: 'a'.repeat(MAX_SUBJECT_CHARS + 1) }))).toThrow(
      /longer than/,
    )
  })
})

describe('the allowlist that keeps dev and qa from writing to strangers', () => {
  it('reads a comma separated list, ignoring case and blanks', () => {
    expect(parseAllowlist(' Ada@Example.com , ,@nekolog.io ')).toEqual([
      'ada@example.com',
      '@nekolog.io',
    ])
  })

  it('treats a missing list as empty, which allows nobody', () => {
    expect(parseAllowlist(undefined)).toEqual([])
    expect(allowedBy([], 'ada@example.com')).toBe(false)
  })

  it('matches an address exactly and a domain by its at sign', () => {
    const allowlist = parseAllowlist('ada@example.com,@nekolog.io')

    expect(allowedBy(allowlist, 'ADA@example.com')).toBe(true)
    expect(allowedBy(allowlist, 'anyone@nekolog.io')).toBe(true)
    expect(allowedBy(allowlist, 'ada@example.com.evil.test')).toBe(false)
    expect(allowedBy(allowlist, 'ada+tag@example.com')).toBe(false)
    expect(allowedBy(allowlist, 'evil@example.com')).toBe(false)
  })

  it('sends nothing at all when the list is empty, instead of sending to everyone', async () => {
    const inner = memoryMailer()
    const mailer = allowlistedMailer(inner, parseAllowlist(undefined))

    await expect(mailer.send(message())).rejects.toThrow(/EMAIL_ALLOWLIST/)
    expect(inner.sent).toHaveLength(0)
  })

  it('stops the message instead of letting it through', async () => {
    const inner = memoryMailer()
    const mailer = allowlistedMailer(inner, parseAllowlist('ada@example.com'))

    await mailer.send(message())
    await expect(mailer.send(message({ to: 'stranger@example.com' }))).rejects.toThrow(
      /EMAIL_ALLOWLIST/,
    )
    expect(inner.sent).toHaveLength(1)
  })
})

function resendFake(response: Partial<HttpResponseLike> & { body?: unknown }): {
  requests: Array<{ url: string; body: Record<string, unknown>; authorization?: string }>
  mailer: Mailer
} {
  const requests: Array<{ url: string; body: Record<string, unknown>; authorization?: string }> = []

  const fetch: FetchLike = async (url, init) => {
    requests.push({
      url,
      body: JSON.parse(init.body) as Record<string, unknown>,
      authorization: init.headers.authorization,
    })
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: () => Promise.resolve(response.body ?? {}),
    }
  }

  return {
    requests,
    mailer: resendMailer({ apiKey: 'a-key', from: 'no-reply@nekolog.io', fetch }),
  }
}

describe('the Resend mailer', () => {
  it('refuses an empty key instead of sending unauthenticated', () => {
    expect(() => resendMailer({ apiKey: '', from: 'no-reply@nekolog.io' })).toThrow(/API key/)
  })

  it('refuses a sender that is not an address', () => {
    expect(() => resendMailer({ apiKey: 'k', from: 'no-reply' })).toThrow(EmailRefused)
  })

  it('sends the message with the key and the configured sender', async () => {
    const { requests, mailer } = resendFake({})

    await mailer.send(message({ text: '123456' }))

    expect(requests[0]?.authorization).toBe('Bearer a-key')
    expect(requests[0]?.body).toEqual({
      from: 'no-reply@nekolog.io',
      to: ['ada@example.com'],
      subject: 'Your code',
      html: '<p>123456</p>',
      text: '123456',
    })
  })

  it('leaves out the plain text part when there is none', async () => {
    const { requests, mailer } = resendFake({})

    await mailer.send(message())

    expect(Object.hasOwn(requests[0]?.body ?? {}, 'text')).toBe(false)
  })

  it('throws when Resend refuses, carrying the status and the reason', async () => {
    const { mailer } = resendFake({
      ok: false,
      status: 422,
      body: { message: 'The domain is not verified' },
    })

    await expect(mailer.send(message())).rejects.toThrow(ResendError)
    await expect(mailer.send(message())).rejects.toThrow(/not verified/)
  })

  it('never reaches the network with a forged header', async () => {
    const { requests, mailer } = resendFake({})

    await expect(
      mailer.send(message({ to: 'ada@example.com\nbcc: evil@example.com' })),
    ).rejects.toThrow(EmailRefused)
    expect(requests).toHaveLength(0)
  })
})

describe('the SMTP mailer', () => {
  function transportFake(): { envelopes: SmtpEnvelope[]; mailer: Mailer } {
    const envelopes: SmtpEnvelope[] = []
    return {
      envelopes,
      mailer: smtpMailer({
        from: 'no-reply@nekolog.test',
        transport: {
          sendMail: (envelope) => {
            envelopes.push(envelope)
            return Promise.resolve(null)
          },
        },
      }),
    }
  }

  it('hands the transport a complete envelope', async () => {
    const { envelopes, mailer } = transportFake()

    await mailer.send(message())

    expect(envelopes[0]).toEqual({
      from: 'no-reply@nekolog.test',
      to: 'ada@example.com',
      subject: 'Your code',
      html: '<p>123456</p>',
    })
  })

  it('never reaches the transport with a forged header', async () => {
    const { envelopes, mailer } = transportFake()

    await expect(mailer.send(message({ subject: 'Hi\r\nbcc: evil@example.com' }))).rejects.toThrow(
      EmailRefused,
    )
    expect(envelopes).toHaveLength(0)
  })
})
