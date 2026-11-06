export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
export const TURNSTILE_TIMEOUT_MS = 5_000

export type TurnstileVerdict = 'off' | 'human' | 'refused'

export type TurnstileOptions = {
  secret: string | undefined
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}

export function turnstileIsOn(secret: string | undefined): boolean {
  return secret !== undefined && secret !== ''
}

export async function checkTurnstile(
  token: string | undefined,
  ip: string,
  options: TurnstileOptions,
): Promise<TurnstileVerdict> {
  if (!turnstileIsOn(options.secret)) {
    return 'off'
  }
  if (token === undefined || token === '') {
    return 'refused'
  }

  const body = new URLSearchParams({
    secret: options.secret as string,
    response: token,
    remoteip: ip,
  })

  try {
    const response = await (options.fetch ?? globalThis.fetch)(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(options.timeoutMs ?? TURNSTILE_TIMEOUT_MS),
    })

    if (!response.ok) {
      return 'refused'
    }

    const answer: unknown = await response.json()
    return (answer as { success?: unknown }).success === true ? 'human' : 'refused'
  } catch {
    return 'refused'
  }
}
