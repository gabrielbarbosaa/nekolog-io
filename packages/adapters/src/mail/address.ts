import type { EmailMessage } from '../mailer.ts'

export const MAX_SUBJECT_CHARS = 200
export const MAX_ADDRESS_CHARS = 254

const FORBIDDEN_IN_ADDRESS = /[\s<>,;"]/
const CONTROL = /[\r\n\0]/

export function looksLikeAddress(value: string): boolean {
  if (value.length === 0 || value.length > MAX_ADDRESS_CHARS) {
    return false
  }

  const at = value.indexOf('@')
  if (at <= 0 || at !== value.lastIndexOf('@')) {
    return false
  }

  const local = value.slice(0, at)
  const domain = value.slice(at + 1)
  if (
    domain.length === 0 ||
    FORBIDDEN_IN_ADDRESS.test(local) ||
    FORBIDDEN_IN_ADDRESS.test(domain)
  ) {
    return false
  }

  const dot = domain.lastIndexOf('.')
  return dot > 0 && dot < domain.length - 1
}

export class EmailRefused extends Error {
  constructor(reason: string) {
    super(`This message cannot be sent: ${reason}`)
    this.name = 'EmailRefused'
  }
}

export function normaliseAddress(value: string): string {
  return value.trim().toLowerCase()
}

export function assertAddress(value: string, what: string): string {
  if (CONTROL.test(value)) {
    throw new EmailRefused(`the ${what} carries a line break, which would forge a header`)
  }
  const address = normaliseAddress(value)
  if (!looksLikeAddress(address)) {
    throw new EmailRefused(`"${value}" is not an address the ${what} can be`)
  }
  return address
}

export function assertMessage(message: EmailMessage): EmailMessage {
  const to = assertAddress(message.to, 'recipient')

  if (CONTROL.test(message.subject)) {
    throw new EmailRefused('the subject carries a line break, which would forge a header')
  }
  if (message.subject.trim() === '') {
    throw new EmailRefused('the subject is empty')
  }
  if (message.subject.length > MAX_SUBJECT_CHARS) {
    throw new EmailRefused(`the subject is longer than ${MAX_SUBJECT_CHARS} characters`)
  }
  if (message.html.trim() === '') {
    throw new EmailRefused('the body is empty')
  }

  return { ...message, to }
}
