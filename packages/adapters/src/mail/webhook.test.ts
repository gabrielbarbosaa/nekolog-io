import { describe, expect, it } from 'vitest'
import { verifyWebhook, WEBHOOK_TOLERANCE_SECONDS, WebhookRefused } from './webhook.ts'

const SECRET = `whsec_${btoa('a signing secret nobody else has')}`
const ID = 'msg_2abc'
const BODY = '{"type":"email.bounced","data":{"to":["ada@example.test"]}}'
const NOW = new Date('2026-11-03T12:00:00Z')
const TIMESTAMP = `${Math.floor(NOW.getTime() / 1000)}`

async function signatureFor(body: string, timestamp = TIMESTAMP, id = ID): Promise<string> {
  const raw = Uint8Array.from(atob(SECRET.slice('whsec_'.length)), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    'raw',
    raw as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  )
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(signed)))}`
}

function headersOf(entries: Record<string, string>) {
  return { get: (name: string) => entries[name.toLowerCase()] ?? null }
}

async function headersFor(body: string, timestamp = TIMESTAMP): Promise<Record<string, string>> {
  return {
    'svix-id': ID,
    'svix-timestamp': timestamp,
    'svix-signature': await signatureFor(body, timestamp),
  }
}

describe('verifyWebhook', () => {
  it('accepts a request the provider really signed', async () => {
    await expect(
      verifyWebhook({
        secret: SECRET,
        headers: headersOf(await headersFor(BODY)),
        body: BODY,
        now: NOW,
      }),
    ).resolves.toBeUndefined()
  })

  it('refuses a body that changed after it was signed', async () => {
    const headers = headersOf(await headersFor(BODY))

    await expect(
      verifyWebhook({
        secret: SECRET,
        headers,
        body: BODY.replace('ada@example.test', 'evil@example.test'),
        now: NOW,
      }),
    ).rejects.toThrow(WebhookRefused)
  })

  it('refuses a signature made with another secret', async () => {
    await expect(
      verifyWebhook({
        secret: `whsec_${btoa('a secret belonging to somebody else')}`,
        headers: headersOf(await headersFor(BODY)),
        body: BODY,
        now: NOW,
      }),
    ).rejects.toThrow(WebhookRefused)
  })

  it.each(['svix-id', 'svix-timestamp', 'svix-signature'])(
    'refuses a request with no %s',
    async (missing) => {
      const entries = await headersFor(BODY)
      delete entries[missing]

      await expect(
        verifyWebhook({ secret: SECRET, headers: headersOf(entries), body: BODY, now: NOW }),
      ).rejects.toThrow(WebhookRefused)
    },
  )

  it('refuses a replay from beyond the tolerance', async () => {
    const old = `${Math.floor(NOW.getTime() / 1000) - WEBHOOK_TOLERANCE_SECONDS - 1}`

    await expect(
      verifyWebhook({
        secret: SECRET,
        headers: headersOf(await headersFor(BODY, old)),
        body: BODY,
        now: NOW,
      }),
    ).rejects.toThrow(WebhookRefused)
  })

  it('accepts one that is merely late, inside the tolerance', async () => {
    const late = `${Math.floor(NOW.getTime() / 1000) - WEBHOOK_TOLERANCE_SECONDS + 10}`

    await expect(
      verifyWebhook({
        secret: SECRET,
        headers: headersOf(await headersFor(BODY, late)),
        body: BODY,
        now: NOW,
      }),
    ).resolves.toBeUndefined()
  })

  it('refuses a timestamp from the future, which a clock cannot explain', async () => {
    const ahead = `${Math.floor(NOW.getTime() / 1000) + WEBHOOK_TOLERANCE_SECONDS + 1}`

    await expect(
      verifyWebhook({
        secret: SECRET,
        headers: headersOf(await headersFor(BODY, ahead)),
        body: BODY,
        now: NOW,
      }),
    ).rejects.toThrow(WebhookRefused)
  })

  it.each(['not-a-number', '', '12.5', '1e9'])('refuses the timestamp %j', async (timestamp) => {
    const entries = await headersFor(BODY)
    entries['svix-timestamp'] = timestamp

    await expect(
      verifyWebhook({ secret: SECRET, headers: headersOf(entries), body: BODY, now: NOW }),
    ).rejects.toThrow(WebhookRefused)
  })

  it('refuses a signature header that offers no v1 version', async () => {
    const entries = await headersFor(BODY)
    entries['svix-signature'] = entries['svix-signature']?.replace('v1,', 'v2,') ?? ''

    await expect(
      verifyWebhook({ secret: SECRET, headers: headersOf(entries), body: BODY, now: NOW }),
    ).rejects.toThrow(WebhookRefused)
  })

  it('accepts when one of several offered signatures matches, as a rotation needs', async () => {
    const entries = await headersFor(BODY)
    entries['svix-signature'] = `v1,AAAA ${entries['svix-signature']}`

    await expect(
      verifyWebhook({ secret: SECRET, headers: headersOf(entries), body: BODY, now: NOW }),
    ).resolves.toBeUndefined()
  })

  it('does not accept a signature that is merely a prefix of the right one', async () => {
    const entries = await headersFor(BODY)
    const full = entries['svix-signature'] ?? ''
    entries['svix-signature'] = full.slice(0, full.length - 4)

    await expect(
      verifyWebhook({ secret: SECRET, headers: headersOf(entries), body: BODY, now: NOW }),
    ).rejects.toThrow(WebhookRefused)
  })
})
