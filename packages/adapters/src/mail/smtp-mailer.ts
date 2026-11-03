import type { Mailer } from '../mailer.ts'
import { assertAddress, assertMessage } from './address.ts'

export interface SmtpEnvelope {
  from: string
  to: string
  subject: string
  html: string
  text?: string
}

export interface SmtpTransportLike {
  sendMail(envelope: SmtpEnvelope): Promise<unknown>
}

export interface SmtpMailerOptions {
  transport: SmtpTransportLike
  from: string
}

export function smtpMailer(options: SmtpMailerOptions): Mailer {
  const from = assertAddress(options.from, 'sender')

  return {
    async send(message) {
      const checked = assertMessage(message)

      await options.transport.sendMail({
        from,
        to: checked.to,
        subject: checked.subject,
        html: checked.html,
        ...(checked.text === undefined ? {} : { text: checked.text }),
      })
    },
  }
}
