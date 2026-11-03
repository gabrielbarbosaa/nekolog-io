import type { EmailMessage, Mailer } from '../mailer.ts'
import { assertMessage, EmailRefused } from './address.ts'

export type SuppressionList = {
  has(address: string): Promise<boolean>
}

export function suppressedMailer(inner: Mailer, list: SuppressionList): Mailer {
  return {
    async send(message: EmailMessage): Promise<void> {
      const checked = assertMessage(message)

      let suppressed: boolean
      try {
        suppressed = await list.has(checked.to)
      } catch {
        throw new EmailRefused(
          `cannot tell whether ${checked.to} is suppressed, so nothing was sent`,
        )
      }

      if (suppressed) {
        throw new EmailRefused(
          `${checked.to} bounced or complained before; sending again would cost the whole domain its reputation`,
        )
      }

      await inner.send(checked)
    },
  }
}
