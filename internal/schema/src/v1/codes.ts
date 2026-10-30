export const BATCH_ERROR_CODES = [
  'invalid_payload',
  'unsupported_schema_version',
  'invalid_key',
  'secret_key_in_url',
  'origin_not_allowed',
  'payload_too_large',
  'rate_limited',
  'quota_exceeded',
] as const

export type BatchErrorCode = (typeof BATCH_ERROR_CODES)[number]

export const EVENT_REJECTION_CODES = [
  'invalid_event',
  'invalid_timestamp',
  'invalid_level',
  'invalid_message',
  'invalid_attributes',
  'invalid_trace',
  'invalid_session',
  'invalid_error',
  'invalid_fingerprint',
] as const

export type EventRejectionCode = (typeof EVENT_REJECTION_CODES)[number]

const REJECTABLE_EVENT_FIELDS = new Set([
  'timestamp',
  'level',
  'message',
  'attributes',
  'trace',
  'session',
  'error',
  'fingerprint',
])

export function rejectionCodeForField(field: string | undefined): EventRejectionCode {
  if (field && REJECTABLE_EVENT_FIELDS.has(field)) {
    return `invalid_${field}` as EventRejectionCode
  }
  return 'invalid_event'
}
