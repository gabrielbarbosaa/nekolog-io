export const API_ERROR_CODES = [
  'invalid_key',
  'secret_key_in_url',
  'insufficient_scope',
  'invalid_query',
  'period_too_long',
  'not_found',
  'rate_limited',
  'upstream_unavailable',
  'internal_error',
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

export const STATUS_FOR_CODE: Record<ApiErrorCode, number> = {
  invalid_key: 401,
  secret_key_in_url: 401,
  insufficient_scope: 403,
  invalid_query: 400,
  period_too_long: 400,
  not_found: 404,
  rate_limited: 429,
  upstream_unavailable: 503,
  internal_error: 500,
}

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode
    message: string
    retryAfter: number | null
  }
}

export function errorBody(
  code: ApiErrorCode,
  message: string,
  retryAfter: number | null = null,
): ApiErrorBody {
  return { error: { code, message, retryAfter } }
}

export function statusFor(code: ApiErrorCode): number {
  return STATUS_FOR_CODE[code]
}

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly retryAfter: number | null

  constructor(code: ApiErrorCode, message: string, retryAfter: number | null = null) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.retryAfter = retryAfter
  }
}
