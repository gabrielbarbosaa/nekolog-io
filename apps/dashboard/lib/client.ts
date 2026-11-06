export type Answer<T> =
  | { ok: true; body: T }
  | { ok: false; error: string; status: number; detail?: string }

export async function call<T>(path: string, body?: Record<string, unknown>): Promise<Answer<T>> {
  let response: Response
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    return { ok: false, error: 'offline', status: 0 }
  }

  let parsed: unknown = null
  try {
    parsed = await response.json()
  } catch {
    parsed = null
  }

  if (response.ok) {
    return { ok: true, body: (parsed ?? {}) as T }
  }

  const answered = parsed as { error?: unknown; detail?: unknown } | null
  const named = answered?.error
  const detail = answered?.detail

  return {
    ok: false,
    status: response.status,
    error: typeof named === 'string' && named !== '' ? named : 'unknown',
    ...(typeof detail === 'string' && detail !== '' ? { detail } : {}),
  }
}
