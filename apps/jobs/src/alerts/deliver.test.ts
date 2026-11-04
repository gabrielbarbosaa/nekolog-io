import type { AlertChannel, EmailMessage, PendingAlert } from '@nekolog-io/adapters'
import { newChannelSecret, SIGNATURE_HEADER, sealSecret, signPayload } from '@nekolog-io/adapters'
import { describe, expect, it } from 'vitest'
import {
  DELIVERY_TIMEOUT_MS,
  type DeliveryOptions,
  deliver,
  discordBody,
  type Fetcher,
  slackBody,
  webhookBody,
} from './deliver.ts'
import { alertMessage } from './message.ts'

const KEY = 'a'.repeat(64)
const DASHBOARD = 'https://app.nekolog.io'
const ENVIRONMENT = 'env_01JBQ8R4T7V2WXYZ0123456789'
const CHANNEL = 'ch_01JBQ8R4T7V2WXYZ0123456789'
const AT = Date.UTC(2026, 10, 4, 12, 0, 0)

function alert(overrides: Partial<PendingAlert> = {}): PendingAlert {
  return {
    ruleId: 'alr_01JBQ8R4T7V2WXYZ0123456789',
    projectId: 'prj_1',
    environmentId: ENVIRONMENT,
    environmentName: 'production',
    ruleName: 'too many errors',
    state: 'firing',
    measured: 99,
    threshold: 50,
    window: '5m',
    query: 'level:error',
    type: 'threshold',
    channels: [CHANNEL],
    changedAt: AT,
    cooldownMinutes: 30,
    lastFiringNoticeAt: null,
    ...overrides,
  }
}

function channel(overrides: Partial<AlertChannel> = {}): AlertChannel {
  return {
    id: CHANNEL,
    projectId: 'prj_1',
    name: 'ops',
    kind: 'slack',
    target: 'https://hooks.slack.com/services/T000/B000/XXXX',
    sealedSecret: null,
    previousSealedSecret: null,
    locale: 'en',
    ...overrides,
  }
}

type Sent = { url: string; init: Parameters<Fetcher>[1] }

function harness(answer: { ok?: boolean; status?: number; body?: string } = {}) {
  const sent: Sent[] = []
  const mails: EmailMessage[] = []

  const fetcher: Fetcher = async (url, init) => {
    sent.push({ url, init })
    return {
      ok: answer.ok ?? true,
      status: answer.status ?? 200,
      async text() {
        return answer.body ?? ''
      },
    }
  }

  const options: DeliveryOptions = {
    fetch: fetcher,
    secretKey: KEY,
    dashboardUrl: DASHBOARD,
    mailer: {
      async send(message) {
        mails.push(message)
      },
    },
  }

  return { sent, mails, options }
}

describe('what each kind of channel receives', () => {
  it('sends an e-mail with both parts and never a webhook', async () => {
    const one = harness()

    await deliver(alert(), channel({ kind: 'email', target: 'ops@example.com' }), one.options)

    expect(one.sent).toEqual([])
    expect(one.mails[0]).toMatchObject({ to: 'ops@example.com' })
    expect(one.mails[0]?.subject).toContain('too many errors')
    expect(one.mails[0]?.html).toContain(`${DASHBOARD}/explorer`)
  })

  it('posts Slack its own shape', async () => {
    const one = harness()

    await deliver(alert(), channel({ kind: 'slack' }), one.options)

    expect(JSON.parse(one.sent[0]?.init.body ?? '{}')).toHaveProperty('text')
    expect(one.sent[0]?.init.headers['content-type']).toBe('application/json')
  })

  it('posts Discord its own shape', async () => {
    const one = harness()

    await deliver(
      alert(),
      channel({ kind: 'discord', target: 'https://discord.com/api/webhooks/1/x' }),
      one.options,
    )

    expect(JSON.parse(one.sent[0]?.init.body ?? '{}')).toHaveProperty('content')
  })

  it('signs a webhook body with the channel own secret', async () => {
    const secret = newChannelSecret()
    const one = harness()
    const sealed = await sealSecret(secret, KEY, CHANNEL)

    await deliver(
      alert(),
      channel({ kind: 'webhook', target: 'https://ops.example.com/hook', sealedSecret: sealed }),
      one.options,
    )

    const signature = one.sent[0]?.init.headers[SIGNATURE_HEADER.toLowerCase()]
    expect(signature).toBe(await signPayload(one.sent[0]?.init.body ?? '', secret))
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/)
  })

  it('sends both signatures while a rotation overlaps', async () => {
    const current = newChannelSecret()
    const previous = newChannelSecret()
    const one = harness()

    await deliver(
      alert(),
      channel({
        kind: 'webhook',
        target: 'https://ops.example.com/hook',
        sealedSecret: await sealSecret(current, KEY, CHANNEL),
        previousSealedSecret: await sealSecret(previous, KEY, CHANNEL),
      }),
      one.options,
    )

    const header = one.sent[0]?.init.headers[SIGNATURE_HEADER.toLowerCase()] ?? ''
    const body = one.sent[0]?.init.body ?? ''

    expect(header.split(',')).toHaveLength(2)
    expect(header).toContain(await signPayload(body, current))
    expect(header).toContain(await signPayload(body, previous))
  })

  it('sends one signature once the rotation is finished', async () => {
    const current = newChannelSecret()
    const one = harness()

    await deliver(
      alert(),
      channel({
        kind: 'webhook',
        target: 'https://ops.example.com/hook',
        sealedSecret: await sealSecret(current, KEY, CHANNEL),
        previousSealedSecret: null,
      }),
      one.options,
    )

    expect(
      (one.sent[0]?.init.headers[SIGNATURE_HEADER.toLowerCase()] ?? '').split(','),
    ).toHaveLength(1)
  })

  it('never signs with the key that opens the box, only with what was inside', async () => {
    const secret = newChannelSecret()
    const one = harness()
    const sealed = await sealSecret(secret, KEY, CHANNEL)

    await deliver(
      alert(),
      channel({ kind: 'webhook', target: 'https://ops.example.com/hook', sealedSecret: sealed }),
      one.options,
    )

    const signature = one.sent[0]?.init.headers[SIGNATURE_HEADER.toLowerCase()]
    expect(signature).not.toBe(await signPayload(one.sent[0]?.init.body ?? '', KEY))
  })

  it('never puts the secret anywhere in the request', async () => {
    const secret = newChannelSecret()
    const one = harness()
    const sealed = await sealSecret(secret, KEY, CHANNEL)

    await deliver(
      alert(),
      channel({ kind: 'webhook', target: 'https://ops.example.com/hook', sealedSecret: sealed }),
      one.options,
    )

    const serialised = JSON.stringify(one.sent[0])
    expect(serialised).not.toContain(secret)
    expect(serialised).not.toContain(KEY)
    expect(serialised).not.toContain(sealed)
  })

  it('refuses to send a webhook that has no secret to sign with', async () => {
    const one = harness()

    await expect(
      deliver(
        alert(),
        channel({ kind: 'webhook', target: 'https://ops.example.com/hook', sealedSecret: null }),
        one.options,
      ),
    ).rejects.toThrow(/cannot be signed/)
    expect(one.sent).toEqual([])
  })

  it('refuses to send a webhook when there is no key to open the secret', async () => {
    const one = harness()
    const sealed = await sealSecret(newChannelSecret(), KEY, CHANNEL)

    await expect(
      deliver(
        alert(),
        channel({ kind: 'webhook', target: 'https://ops.example.com/hook', sealedSecret: sealed }),
        { ...one.options, secretKey: undefined },
      ),
    ).rejects.toThrow(/no key to open/)
    expect(one.sent).toEqual([])
  })
})

describe('the request it makes', () => {
  it('never follows a redirect, which is how a public address becomes a private one', async () => {
    const one = harness()

    await deliver(alert(), channel(), one.options)

    expect(one.sent[0]?.init.redirect).toBe('manual')
  })

  it('carries a deadline, so a slow endpoint cannot hold the run', async () => {
    const one = harness()

    await deliver(alert(), channel(), one.options)

    expect(one.sent[0]?.init.signal).toBeInstanceOf(AbortSignal)
    expect(DELIVERY_TIMEOUT_MS).toBe(5000)
  })

  it('gives up on a slow endpoint rather than waiting for it', async () => {
    const options: DeliveryOptions = {
      dashboardUrl: DASHBOARD,
      timeoutMs: 10,
      fetch: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    }

    const started = Date.now()

    await expect(deliver(alert(), channel(), options)).rejects.toThrow(/aborted/)
    expect(Date.now() - started).toBeLessThan(DELIVERY_TIMEOUT_MS)
  })

  it('reports what the endpoint said when it refused', async () => {
    const one = harness({ ok: false, status: 403, body: 'nope' })

    await expect(deliver(alert(), channel(), one.options)).rejects.toThrow(/answered 403: nope/)
  })

  it('refuses an address the SSRF guard rejects, even though the row already held it', async () => {
    const one = harness()

    for (const target of [
      'https://169.254.169.254/latest/meta-data/',
      'https://localhost/hook',
      'http://hooks.slack.com/x',
      'https://10.0.0.1/hook',
    ]) {
      await expect(deliver(alert(), channel({ target }), one.options)).rejects.toThrow(/Refusing/)
    }
    expect(one.sent).toEqual([])
  })

  it('refuses to post at all when the run has no way to make a request', async () => {
    await expect(deliver(alert(), channel(), { dashboardUrl: DASHBOARD })).rejects.toThrow(
      /no way to make an outbound request/,
    )
  })
})

describe('the bodies', () => {
  const message = alertMessage(alert(), DASHBOARD, 'en')

  it('give Slack a text field and Discord a content field', () => {
    expect(Object.keys(JSON.parse(slackBody(message)))).toEqual(['text'])
    expect(Object.keys(JSON.parse(discordBody(message)))).toEqual(['content'])
  })

  it('give a webhook a versioned object with no free text to parse', () => {
    const body = JSON.parse(webhookBody(alert(), message))

    expect(body.schemaVersion).toBe(1)
    expect(body.rule).toEqual({
      id: 'alr_01JBQ8R4T7V2WXYZ0123456789',
      name: 'too many errors',
      type: 'threshold',
    })
    expect(body.state).toBe('firing')
    expect(body.measured).toBe(99)
    expect(body.threshold).toBe(50)
    expect(body.changedAt).toBe('2026-11-04T12:00:00.000Z')
  })

  it('carry the link in every shape', () => {
    expect(slackBody(message)).toContain('/explorer')
    expect(discordBody(message)).toContain('/explorer')
    expect(webhookBody(alert(), message)).toContain('/explorer')
  })
})
