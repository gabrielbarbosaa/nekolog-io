import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './password.ts'
import { lookupBreach, type PwnedOptions } from './pwned.ts'

export type PasswordRefusal = 'too-short' | 'too-long' | 'breached'

export type PasswordVerdict =
  | { accepted: true; breachCheck: 'clean' | 'unknown' }
  | { accepted: false; refusal: PasswordRefusal }

export function checkShape(password: string): PasswordRefusal | undefined {
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    return 'too-short'
  }
  if ([...password].length > MAX_PASSWORD_LENGTH) {
    return 'too-long'
  }
  return undefined
}

export async function checkPassword(
  password: string,
  options: PwnedOptions = {},
): Promise<PasswordVerdict> {
  const refusal = checkShape(password)
  if (refusal) {
    return { accepted: false, refusal }
  }

  const breach = await lookupBreach(password, options)
  if (breach === 'breached') {
    return { accepted: false, refusal: 'breached' }
  }

  return { accepted: true, breachCheck: breach }
}
