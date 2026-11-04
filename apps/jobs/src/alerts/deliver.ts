import type { AlertChannel, Mailer, PendingAlert } from '@nekolog-io/adapters'
import {
  assertWebhookTarget,
  openSecret,
  SIGNATURE_HEADER,
  signPayload,
} from '@nekolog-io/adapters'
import { type AlertMessage, alertMessage } from './message.ts'

export const DELIVERY_TIMEOUT_MS = 5000
export const MAX_RESPONSE_CHARS = 500

export type Fetcher = (
  input: string,
  init: {
    method: string
    headers: Record<string, string>
    body: string
    redirect: 'manual'
    signal?: AbortSignal
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

export type DeliveryOptions = {
  mailer?: Mailer
  fetch?: Fetcher
  secretKey?: string
  dashboardUrl: string
  timeoutMs?: number
}

export function slackBody(message: AlertMessage): string {
  return JSON.stringify({
    text: `${message.subject}\n${message.lines.map(([l, v]) => `${l}: ${v}`).join('\n')}\n${message.url}`,
  })
}

export function discordBody(message: AlertMessage): string {
  return JSON.stringify({
    content: `**${message.subject}**\n${message.lines
      .map(([label, value]) => `${label}: ${value}`)
      .join('\n')}\n${message.url}`,
  })
}

export function webhookBody(alert: PendingAlert, message: AlertMessage): string {
  return JSON.stringify({
    schemaVersion: 1,
    rule: { id: alert.ruleId, name: alert.ruleName, type: alert.type },
    state: alert.state,
    environment: { id: alert.environmentId, name: alert.environmentName },
    measured: alert.measured,
    threshold: alert.threshold,
    window: alert.window,
    changedAt: new Date(alert.changedAt).toISOString(),
    url: message.url,
  })
}

async function post(
  url: string,
  body: string,
  headers: Record<string, string>,
  options: DeliveryOptions,
): Promise<void> {
  const send = options.fetch
  if (send === undefined) {
    throw new Error('This run has no way to make an outbound request')
  }

  assertWebhookTarget(url)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DELIVERY_TIMEOUT_MS)

  try {
    const response = await send(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
      redirect: 'manual',
      signal: controller.signal,
    })

    if (!response.ok) {
      const detail = (await response.text()).slice(0, MAX_RESPONSE_CHARS)
      throw new Error(`the endpoint answered ${response.status}: ${detail}`)
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function deliver(
  alert: PendingAlert,
  channel: AlertChannel,
  options: DeliveryOptions,
): Promise<void> {
  const message = alertMessage(alert, options.dashboardUrl, channel.locale)

  if (channel.kind === 'email') {
    if (options.mailer === undefined) {
      throw new Error('This run has no mailer, so it cannot send an alert by e-mail')
    }
    await options.mailer.send({
      to: channel.target,
      subject: message.subject,
      html: message.html,
      text: message.text,
    })
    return
  }

  if (channel.kind === 'slack') {
    await post(channel.target, slackBody(message), {}, options)
    return
  }

  if (channel.kind === 'discord') {
    await post(channel.target, discordBody(message), {}, options)
    return
  }

  if (channel.sealedSecret === null) {
    throw new Error('A webhook channel without a secret cannot be signed, so nothing is sent')
  }
  if (options.secretKey === undefined) {
    throw new Error('This run has no key to open the channel secret with')
  }

  const secret = await openSecret(channel.sealedSecret, options.secretKey, channel.id)
  const body = webhookBody(alert, message)
  const signature = await signPayload(body, secret)

  await post(channel.target, body, { [SIGNATURE_HEADER.toLowerCase()]: signature }, options)
}
