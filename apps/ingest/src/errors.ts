import type { BatchErrorCode } from '@internal/schema'

export const STATUS_FOR_CODE: Record<BatchErrorCode, number> = {
  invalid_payload: 400,
  unsupported_schema_version: 400,
  invalid_key: 401,
  secret_key_in_url: 401,
  origin_not_allowed: 403,
  payload_too_large: 413,
  rate_limited: 429,
  quota_exceeded: 429,
}

export type ErrorBody = {
  error: {
    code: BatchErrorCode
    message: string
    retryAfter: number | null
  }
}

export function errorBody(
  code: BatchErrorCode,
  message: string,
  retryAfter: number | null = null,
): ErrorBody {
  return { error: { code, message, retryAfter } }
}

export function statusFor(code: BatchErrorCode): number {
  return STATUS_FOR_CODE[code]
}
