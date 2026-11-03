import { isSecretKey } from '@nekolog-io/core'

export const SECRET_KEY_IN_A_BROWSER =
  'A secret key must never reach a browser, where anyone can read it. Use the public key of this environment.'

export type KeyChoice = { apiKey?: string; refusal?: string }

export function publicKeyOnly(apiKey: unknown): KeyChoice {
  if (typeof apiKey !== 'string') {
    return {}
  }

  const trimmed = apiKey.trim()
  if (trimmed === '') {
    return {}
  }
  if (isSecretKey(trimmed)) {
    return { refusal: SECRET_KEY_IN_A_BROWSER }
  }
  return { apiKey: trimmed }
}
