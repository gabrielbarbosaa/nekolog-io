export const PWNED_RANGE_URL = 'https://api.pwnedpasswords.com/range/'
export const PWNED_PREFIX_LENGTH = 5
export const PWNED_TIMEOUT_MS = 2_000

export type BreachLookup = 'breached' | 'clean' | 'unknown'

export type PwnedOptions = {
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}

async function sha1Hex(password: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

export function suffixAppears(body: string, suffix: string): boolean {
  for (const line of body.split('\n')) {
    const found = line.split(':')[0]?.trim().toUpperCase()
    if (found === suffix) {
      return true
    }
  }
  return false
}

export async function lookupBreach(
  password: string,
  options: PwnedOptions = {},
): Promise<BreachLookup> {
  const send = options.fetch ?? globalThis.fetch
  const digest = await sha1Hex(password)
  const prefix = digest.slice(0, PWNED_PREFIX_LENGTH)
  const suffix = digest.slice(PWNED_PREFIX_LENGTH)

  try {
    const response = await send(`${PWNED_RANGE_URL}${prefix}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(options.timeoutMs ?? PWNED_TIMEOUT_MS),
    })

    if (!response.ok) {
      return 'unknown'
    }

    return suffixAppears(await response.text(), suffix) ? 'breached' : 'clean'
  } catch {
    return 'unknown'
  }
}
