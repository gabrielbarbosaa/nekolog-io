import { describe, expect, it } from 'vitest'
import {
  MAX_ATTRIBUTE_VALUE_BYTES,
  MAX_ERROR_MESSAGE_BYTES,
  MAX_ERROR_STACK_BYTES,
  MAX_MESSAGE_BYTES,
} from './limits.ts'
import {
  cpfValid,
  createKeyMatcher,
  luhnValid,
  REDACTED,
  type RedactionPolicy,
  redactText,
  scrubEvent,
} from './redact.ts'
import type { LogEvent } from './types.ts'
import { utf8ByteLength } from './utf8.ts'

const SHORT_TOKEN = 'Bearer a '
const REDACTION_BUDGET_MS = 250

function policy(overrides: Partial<RedactionPolicy> = {}): RedactionPolicy {
  return { matchesKey: createKeyMatcher(), patterns: [], scrubText: true, ...overrides }
}

function event(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    timestamp: '2026-10-31T12:00:00.000Z',
    level: 'info',
    message: 'ok',
    ...overrides,
  }
}

describe('key matching', () => {
  const matches = createKeyMatcher()

  it.each([
    'password',
    'user.password',
    'passwordHash',
    'PASSWORD',
    'user_pwd',
    'API_KEY',
    'apiKey',
    'request.headers.authorization',
    'set-cookie',
    'customer.cpf',
    'card.cvv',
    'creditCard',
    'card_number',
    'session_id',
    'privateKey',
    'client.secret',
  ])('treats %s as sensitive', (key) => {
    expect(matches(key)).toBe(true)
  })

  it.each([
    'username',
    'author',
    'authorName',
    'user.id',
    'orderId',
    'message',
    'durationMs',
    'publicUrl',
  ])('leaves %s alone', (key) => {
    expect(matches(key)).toBe(false)
  })

  it('redacts a whole subtree, because flattening splits it into leaves', () => {
    expect(matches('user.password.length')).toBe(true)
    expect(matches('credentials.token.exp')).toBe(true)
  })

  it('takes extra keys', () => {
    const custom = createKeyMatcher(['pacienteId'])
    expect(custom('body.pacienteId')).toBe(true)
    expect(matches('body.pacienteId')).toBe(false)
  })

  it('takes an exact key out of the way, without disarming the rest', () => {
    const custom = createKeyMatcher([], ['tokenCount'])
    expect(custom('metrics.tokenCount')).toBe(false)
    expect(custom('auth.token')).toBe(true)
  })

  it('drops a default needle when the skipped key is the needle itself', () => {
    const custom = createKeyMatcher([], ['token'])
    expect(custom('auth.accessToken')).toBe(false)
    expect(custom('user.password')).toBe(true)
  })
})

describe('luhn', () => {
  it.each(['4111111111111111', '5500005555555559', '378282246310005', '6011111111111117'])(
    'accepts %s',
    (digits) => {
      expect(luhnValid(digits)).toBe(true)
    },
  )

  it.each(['4111111111111112', '1234567890123', ''])('rejects %s', (digits) => {
    expect(luhnValid(digits)).toBe(false)
  })
})

describe('cpf', () => {
  it.each(['52998224725', '11144477735'])('accepts %s', (digits) => {
    expect(cpfValid(digits)).toBe(true)
  })

  it.each(['52998224726', '1234567890', '123456789012'])('rejects %s', (digits) => {
    expect(cpfValid(digits)).toBe(false)
  })

  it('rejects a repeated digit, which passes the arithmetic but is never a real CPF', () => {
    expect(cpfValid('11111111111')).toBe(false)
    expect(cpfValid('00000000000')).toBe(false)
  })
})

describe('text redaction', () => {
  it('redacts a card number however it is written', () => {
    expect(redactText('paid with 4111111111111111')).toBe(`paid with ${REDACTED}`)
    expect(redactText('card 4111-1111-1111-1111 declined')).toBe(`card ${REDACTED} declined`)
    expect(redactText('card 4111 1111 1111 1111 declined')).toBe(`card ${REDACTED} declined`)
  })

  it('leaves a long number that is not a card, which is what Luhn is for', () => {
    expect(redactText('order 4111111111111112')).toBe('order 4111111111111112')
    expect(redactText('invoice 123456789012')).toBe('invoice 123456789012')
  })

  it('does not redact part of a longer run of digits', () => {
    const id = '99941111111111111199'
    expect(redactText(`id ${id}`)).toBe(`id ${id}`)
  })

  it('redacts a CPF, formatted or bare', () => {
    expect(redactText('CPF 529.982.247-25')).toBe(`CPF ${REDACTED}`)
    expect(redactText('cpf=52998224725 ok')).toBe(`cpf=${REDACTED} ok`)
  })

  it('leaves an eleven digit number that is not a CPF', () => {
    expect(redactText('ticket 52998224726')).toBe('ticket 52998224726')
    expect(redactText('seq 11111111111')).toBe('seq 11111111111')
  })

  it('redacts a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.Qm9ndXNTaWduYXR1cmU'
    expect(redactText(`token ${jwt}`)).toBe(`token ${REDACTED}`)
  })

  it('keeps the scheme and drops the credential', () => {
    expect(redactText('Authorization: Bearer abc.def-ghi')).toBe(
      `Authorization: Bearer ${REDACTED}`,
    )
    expect(redactText('basic dXNlcjpwYXNz==')).toBe(`basic ${REDACTED}`)
  })

  it('keeps the NekoLog key prefix so the log still says which key leaked', () => {
    expect(redactText('used nekolog_sk_abc123DEF')).toBe(`used nekolog_sk_${REDACTED}`)
    expect(redactText('used nekolog_pk_abc123DEF')).toBe(`used nekolog_pk_${REDACTED}`)
  })

  it('redacts credentials inside a URL', () => {
    expect(redactText('connect to https://admin:hunter2@db.internal/x')).toBe(
      `connect to https://${REDACTED}@db.internal/x`,
    )
  })

  it('applies extra patterns', () => {
    expect(redactText('ref ABC-999', [/ABC-\d+/])).toBe(`ref ${REDACTED}`)
  })

  it('applies a non-global extra pattern to every occurrence', () => {
    expect(redactText('a X b X', [/X/])).toBe(`a ${REDACTED} b ${REDACTED}`)
  })

  it('does not let a stateful extra pattern skip a later log', () => {
    const pattern = /X/g
    expect(redactText('a X', [pattern])).toBe(`a ${REDACTED}`)
    expect(redactText('a X', [pattern])).toBe(`a ${REDACTED}`)
  })

  it('leaves ordinary text untouched', () => {
    const text = 'GET /orders/42 took 18ms for user 7 on 2026-10-31'
    expect(redactText(text)).toBe(text)
  })

  describe('key=value inside free text', () => {
    const matches = createKeyMatcher()
    const redact = (text: string) => redactText(text, [], matches)

    it.each([
      ['password=hunter2', `password=${REDACTED}`],
      ['password: hunter2', `password: ${REDACTED}`],
      ['API_KEY = abc123', `API_KEY = ${REDACTED}`],
      ['{"password":"hunter2"}', `{"password":${REDACTED}}`],
      ["{'secret': 'shh'}", `{'secret': ${REDACTED}}`],
      ['/login?token=abc123&user=ana', `/login?token=${REDACTED}&user=ana`],
      ['authorization: Bearer abc.def', `authorization: ${REDACTED}`],
      ['x-api-key: Token zzz', `x-api-key: ${REDACTED}`],
    ])('redacts %s', (input, expected) => {
      expect(redact(input)).toBe(expected)
    })

    it.each([
      'user=ana',
      'orderId=42',
      'took=18ms',
      'time: 12:30',
      'url=https://nekolog.io/docs',
      'author: Gabriel',
    ])('leaves %s alone', (input) => {
      expect(redact(input)).toBe(input)
    })

    it('redacts only the sensitive pair in a line of many', () => {
      expect(redact('user=ana password=hunter2 step=login')).toBe(
        `user=ana password=${REDACTED} step=login`,
      )
    })

    it('does not let an innocent key swallow the sensitive pair after it', () => {
      expect(redact('callback failed: ?secret=zzz&id=9')).toBe(
        `callback failed: ?secret=${REDACTED}&id=9`,
      )
      expect(redact('note: see token=abc for details')).toBe(
        `note: see token=${REDACTED} for details`,
      )
      expect(redact('a=1 b=2 c=3 password=x')).toBe(`a=1 b=2 c=3 password=${REDACTED}`)
    })

    it('finds every sensitive pair, not just the first', () => {
      expect(redact('token=a user=ana secret=b')).toBe(
        `token=${REDACTED} user=ana secret=${REDACTED}`,
      )
    })

    it('does not match a sensitive word that is part of a longer key', () => {
      expect(redact('not_a_password_field_here=1')).toBe(`not_a_password_field_here=${REDACTED}`)
      expect(redact('username=ana')).toBe('username=ana')
    })

    it('is off when no key matcher is given, which is the old signature', () => {
      expect(redactText('password=hunter2')).toBe('password=hunter2')
    })

    it('reaches the message and the attributes through the policy', () => {
      const scrubbed = scrubEvent(
        event({
          message: 'POST /login?token=abc123 failed',
          attributes: { note: 'tried password=hunter2' },
        }),
        policy(),
      )

      expect(scrubbed.message).toBe(`POST /login?token=${REDACTED} failed`)
      expect(scrubbed.attributes?.note).toBe(`tried password=${REDACTED}`)
    })

    it('respects skipKeys and extraKeys', () => {
      const custom = createKeyMatcher(['prontuario'], ['tokenCount'])

      expect(redactText('tokenCount=12', [], custom)).toBe('tokenCount=12')
      expect(redactText('prontuario=p-1', [], custom)).toBe(`prontuario=${REDACTED}`)
    })
  })

  it.each([
    ['colons without an at sign', `//${'a:'.repeat(MAX_MESSAGE_BYTES / 2)}`],
    ['colons and slashes', `//${'a:b'.repeat(MAX_MESSAGE_BYTES / 3)}`],
    ['one long run of digits', '9'.repeat(MAX_MESSAGE_BYTES)],
    ['digits split by separators', '1 '.repeat(MAX_MESSAGE_BYTES / 2)],
    ['repeated JWT prefixes', 'eyJ'.repeat(MAX_MESSAGE_BYTES / 3)],
    ['repeated auth schemes', 'bearer '.repeat(MAX_MESSAGE_BYTES / 7)],
    ['mixed punctuation', 'a:b@c/d.'.repeat(MAX_MESSAGE_BYTES / 8)],
    ['sensitive pairs back to back', 'password='.repeat(MAX_MESSAGE_BYTES / 9)],
    ['ordinary pairs back to back', 'x=1 '.repeat(MAX_MESSAGE_BYTES / 4)],
    ['quotes that never close', 'secret:"'.repeat(MAX_MESSAGE_BYTES / 8)],
    ['nothing but quotes', '"'.repeat(MAX_MESSAGE_BYTES)],
    ['long keys that nearly match', `${'token_'.repeat(20)}=1 `.repeat(120)],
  ])('stays fast on a full-size message of %s', (_name, input) => {
    const start = performance.now()
    const out = redactText(input, [], createKeyMatcher())
    const elapsed = performance.now() - start

    expect(out.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(REDACTION_BUDGET_MS)
  })
})

describe('event scrubbing', () => {
  it('redacts a value by its key, whatever its type', () => {
    const scrubbed = scrubEvent(
      event({ attributes: { password: 'hunter2', 'card.cvv': 123, remember: true } }),
      policy(),
    )

    expect(scrubbed.attributes).toEqual({
      password: REDACTED,
      'card.cvv': REDACTED,
      remember: true,
    })
  })

  it('scrubs the message, the error message and the stack', () => {
    const scrubbed = scrubEvent(
      event({
        message: 'charge 4111111111111111 failed',
        error: {
          type: 'PaymentError',
          message: 'cpf 529.982.247-25 blocked',
          stack: 'at fetch (https://api:s3cret@gw.internal/pay)',
        },
      }),
      policy(),
    )

    expect(scrubbed.message).toBe(`charge ${REDACTED} failed`)
    expect(scrubbed.error?.message).toBe(`cpf ${REDACTED} blocked`)
    expect(scrubbed.error?.stack).toBe(`at fetch (https://${REDACTED}@gw.internal/pay)`)
    expect(scrubbed.error?.type).toBe('PaymentError')
  })

  it('still redacts by key when text scrubbing is off', () => {
    const scrubbed = scrubEvent(
      event({
        message: 'charge 4111111111111111 failed',
        attributes: { password: 'hunter2', note: 'card 4111111111111111' },
      }),
      policy({ scrubText: false }),
    )

    expect(scrubbed.message).toBe('charge 4111111111111111 failed')
    expect(scrubbed.attributes).toEqual({
      password: REDACTED,
      note: 'card 4111111111111111',
    })
  })

  it('keeps the parts it has no business touching', () => {
    const source = event({
      trace: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) },
      session: { id: 'sess-1', userId: 'user-9' },
      fingerprint: ['PaymentError', 'charge'],
    })

    const scrubbed = scrubEvent(source, policy())

    expect(scrubbed.trace).toEqual(source.trace)
    expect(scrubbed.session).toEqual(source.session)
    expect(scrubbed.fingerprint).toEqual(source.fingerprint)
  })

  it('does not change the event it was given', () => {
    const source = event({ attributes: { password: 'hunter2' } })

    scrubEvent(source, policy())

    expect(source.attributes).toEqual({ password: 'hunter2' })
  })

  it('stays inside the limits even though redaction can make text longer', () => {
    const grows = (limit: number) => SHORT_TOKEN.repeat(Math.ceil(limit / SHORT_TOKEN.length))

    const scrubbed = scrubEvent(
      event({
        message: grows(MAX_MESSAGE_BYTES),
        attributes: { note: grows(MAX_ATTRIBUTE_VALUE_BYTES) },
        error: {
          message: grows(MAX_ERROR_MESSAGE_BYTES),
          stack: grows(MAX_ERROR_STACK_BYTES),
        },
      }),
      policy(),
    )

    expect(utf8ByteLength(scrubbed.message)).toBeGreaterThan(MAX_MESSAGE_BYTES / 2)
    expect(utf8ByteLength(scrubbed.message)).toBeLessThanOrEqual(MAX_MESSAGE_BYTES)
    expect(utf8ByteLength(String(scrubbed.attributes?.note))).toBeLessThanOrEqual(
      MAX_ATTRIBUTE_VALUE_BYTES,
    )
    expect(utf8ByteLength(scrubbed.error?.message ?? '')).toBeLessThanOrEqual(
      MAX_ERROR_MESSAGE_BYTES,
    )
    expect(utf8ByteLength(scrubbed.error?.stack ?? '')).toBeLessThanOrEqual(MAX_ERROR_STACK_BYTES)
  })
})
