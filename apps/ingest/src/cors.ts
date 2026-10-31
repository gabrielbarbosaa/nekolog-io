export const ALLOWED_REQUEST_HEADERS: readonly string[] = [
  'authorization',
  'content-type',
  'content-encoding',
  'traceparent',
  'tracestate',
]

export const PREFLIGHT_MAX_AGE_SECONDS = 86_400

export function corsHeadersFor(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { vary: 'Origin' }
  if (origin !== null && origin !== '') {
    headers['access-control-allow-origin'] = origin
  }
  return headers
}

export function preflightHeadersFor(origin: string | null): Record<string, string> {
  return {
    ...corsHeadersFor(origin),
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': ALLOWED_REQUEST_HEADERS.join(', '),
    'access-control-max-age': String(PREFLIGHT_MAX_AGE_SECONDS),
  }
}

export function withCors(response: Response, origin: string | null): Response {
  for (const [name, value] of Object.entries(corsHeadersFor(origin))) {
    response.headers.set(name, value)
  }
  return response
}
