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

export type DeliveryDecision = 'retry' | 'drop' | 'stop'

const DECISIONS: Record<BatchErrorCode, DeliveryDecision> = {
  invalid_payload: 'drop',
  unsupported_schema_version: 'stop',
  invalid_key: 'stop',
  secret_key_in_url: 'stop',
  origin_not_allowed: 'stop',
  payload_too_large: 'drop',
  rate_limited: 'retry',
  quota_exceeded: 'retry',
}

export function isBatchErrorCode(value: unknown): value is BatchErrorCode {
  return typeof value === 'string' && (BATCH_ERROR_CODES as readonly string[]).includes(value)
}

export function decisionForCode(code: BatchErrorCode): DeliveryDecision {
  return DECISIONS[code]
}

export function decisionForStatus(status: number): DeliveryDecision {
  if (status === 408 || status === 429 || status >= 500) {
    return 'retry'
  }
  if (status === 401 || status === 403) {
    return 'stop'
  }
  return 'drop'
}
