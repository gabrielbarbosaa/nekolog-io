import type { EmailMessage, Mailer } from '../mailer.ts'
import type { FetchLike } from '../redis/upstash-redis.ts'
import { assertAddress, assertMessage } from './address.ts'

export const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export interface ResendMailerOptions {
  apiKey: string
  from: string
  endpoint?: string
  fetch?: FetchLike
}

export class ResendError extends Error {
  readonly status: number

  constructor(status: number, detail: string) {
    super(`Resend refused the message (HTTP ${status}): ${detail}`)
    this.name = 'ResendError'
    this.status = status
  }
}

function ambientFetch(): FetchLike {
  const found = (globalThis as { fetch?: FetchLike }).fetch
  if (found === undefined) {
    throw new Error('This runtime has no fetch, so it cannot reach Resend.')
  }
  return found
}

export function resendMailer(options: ResendMailerOptions): Mailer {
  if (options.apiKey === '') {
    throw new Error('Resend needs an API key; an empty one would send unauthenticated requests.')
  }
  const from = assertAddress(options.from, 'sender')
  const endpoint = options.endpoint ?? RESEND_ENDPOINT
  const send = options.fetch ?? ambientFetch()

  return {
    async send(message: EmailMessage) {
      const checked = assertMessage(message)

      const response = await send(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [checked.to],
          subject: checked.subject,
          html: checked.html,
          ...(checked.text === undefined ? {} : { text: checked.text }),
        }),
      })

      if (!response.ok) {
        throw new ResendError(response.status, await detailOf(response))
      }
    },
  }
}

async function detailOf(response: { json(): Promise<unknown> }): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown; name?: unknown }
    return typeof body.message === 'string' ? body.message : String(body.name ?? 'no detail')
  } catch {
    return 'no detail'
  }
}
