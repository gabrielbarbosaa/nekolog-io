import type { ParsedBatch } from '@internal/schema'
import type { IngestPrincipal } from './app.ts'

export const DEFAULT_RETENTION_DAYS = 30
export const UNRESOLVED_FINGERPRINT = 0
export const ERROR_MESSAGE_ATTRIBUTE = 'error.message'

const COUNTRY_PATTERN = /^[A-Z0-9]{2}$/

export function countryOf(request: Request): string {
  const header = request.headers.get('cf-ipcountry')?.trim().toUpperCase() ?? ''
  if (COUNTRY_PATTERN.test(header)) {
    return header
  }
  const fromPlatform = (request as { cf?: { country?: unknown } }).cf?.country
  if (typeof fromPlatform === 'string') {
    const normalised = fromPlatform.trim().toUpperCase()
    if (COUNTRY_PATTERN.test(normalised)) {
      return normalised
    }
  }
  return ''
}

export function clickHouseTimestamp(value: string | number): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  const safe = Number.isNaN(date.getTime()) ? new Date() : date
  return safe.toISOString().replace('T', ' ').replace('Z', '')
}

function attributeText(value: string | number | boolean | null): string {
  if (value === null) {
    return ''
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  return String(value)
}

export type RowContext = {
  receivedAt: number
  country: string
}

export function rowsFor(
  batch: ParsedBatch,
  principal: IngestPrincipal,
  context: RowContext,
): Array<Record<string, unknown>> {
  const receivedAt = clickHouseTimestamp(context.receivedAt)
  const retentionDays = principal.retentionDays ?? DEFAULT_RETENTION_DAYS

  return batch.accepted.map(({ event }) => {
    const attributes: Record<string, string> = {}
    for (const [key, value] of Object.entries(event.attributes ?? {})) {
      attributes[key] = attributeText(value)
    }

    const errorMessage = event.error?.message
    if (errorMessage !== undefined && errorMessage !== event.message) {
      attributes[ERROR_MESSAGE_ATTRIBUTE] = errorMessage
    }

    return {
      project_id: principal.projectId,
      environment_id: principal.environmentId,
      timestamp: clickHouseTimestamp(event.timestamp),
      received_at: receivedAt,
      level: event.level,
      message: event.message,
      service: batch.resource.service,
      release: batch.resource.release ?? '',
      source: batch.resource.runtime,
      trace_id: event.trace?.traceId ?? '',
      span_id: event.trace?.spanId ?? '',
      session_id: event.session?.id ?? '',
      user_id: event.session?.userId ?? '',
      fingerprint: UNRESOLVED_FINGERPRINT,
      error_type: event.error?.type ?? '',
      stacktrace: event.error?.stack ?? '',
      attributes,
      country: context.country,
      retention_days: retentionDays,
    }
  })
}
