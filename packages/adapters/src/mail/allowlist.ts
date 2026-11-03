import type { Mailer } from '../mailer.ts'
import { EmailRefused, normaliseAddress } from './address.ts'

export function parseAllowlist(value: string | undefined): ReadonlyArray<string> {
  if (value === undefined) {
    return []
  }
  return value
    .split(',')
    .map(normaliseAddress)
    .filter((entry) => entry !== '')
}

export function allowedBy(allowlist: ReadonlyArray<string>, address: string): boolean {
  const recipient = normaliseAddress(address)
  const domain = recipient.slice(recipient.indexOf('@'))

  return allowlist.some(
    (entry) => entry === recipient || (entry.startsWith('@') && entry === domain),
  )
}

export function allowlistedMailer(mailer: Mailer, allowlist: ReadonlyArray<string>): Mailer {
  return {
    async send(message) {
      if (!allowedBy(allowlist, message.to)) {
        throw new EmailRefused(
          `${message.to} is not on EMAIL_ALLOWLIST, and this environment only writes to addresses that are`,
        )
      }
      await mailer.send(message)
    },
  }
}
