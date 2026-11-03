import type { EmailMessage, Mailer } from '../mailer.ts'
import { assertMessage } from './address.ts'

export interface MemoryMailer extends Mailer {
  readonly sent: ReadonlyArray<EmailMessage>
  clear(): void
}

export function memoryMailer(): MemoryMailer {
  const sent: EmailMessage[] = []

  return {
    sent,
    send(message) {
      sent.push(assertMessage(message))
      return Promise.resolve()
    },
    clear() {
      sent.length = 0
    },
  }
}
