import * as v from 'valibot'
import { type BatchErrorCode, type EventRejectionCode, rejectionCodeForField } from './codes'
import { DEFAULT_SERVICE, MAX_BATCH_BYTES, MAX_MESSAGE_BYTES } from './limits'
import {
  type Envelope,
  envelopeSchema,
  eventSchema,
  type LogEvent,
  type Resource,
  type Sdk,
  schemaVersionSchema,
} from './schema'
import { truncateToUtf8Bytes } from './utf8'

export function exceedsBatchSizeLimit(byteLength: number): boolean {
  return byteLength > MAX_BATCH_BYTES
}

export type AcceptedEvent = {
  index: number
  event: LogEvent
  messageTruncated: boolean
}

export type RejectedEvent = {
  index: number
  code: EventRejectionCode
}

export type ParsedBatch = {
  schemaVersion: Envelope['schemaVersion']
  batchId: string
  sdk: Sdk
  resource: Resource & { service: string }
  accepted: AcceptedEvent[]
  rejected: RejectedEvent[]
}

export type ParseResult =
  | { ok: true; batch: ParsedBatch }
  | { ok: false; code: BatchErrorCode; message: string }

function firstIssueField(issues: ReadonlyArray<v.BaseIssue<unknown>>): string | undefined {
  const path = issues[0]?.path
  if (!path || path.length === 0) {
    return undefined
  }
  return String(path[0]?.key)
}

function schemaVersionOf(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) {
    return undefined
  }
  return (input as Record<string, unknown>).schemaVersion
}

export function parseBatch(input: unknown): ParseResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, code: 'invalid_payload', message: 'Body must be a JSON object' }
  }

  const declaredVersion = schemaVersionOf(input)
  if (declaredVersion !== undefined && !v.is(schemaVersionSchema, declaredVersion)) {
    return {
      ok: false,
      code: 'unsupported_schema_version',
      message: `Unsupported schemaVersion: ${String(declaredVersion)}`,
    }
  }

  const envelope = v.safeParse(envelopeSchema, input)
  if (!envelope.success) {
    const field = firstIssueField(envelope.issues)
    return {
      ok: false,
      code: 'invalid_payload',
      message: field
        ? `Invalid "${field}": ${envelope.issues[0]?.message}`
        : (envelope.issues[0]?.message ?? 'Invalid payload'),
    }
  }

  const accepted: AcceptedEvent[] = []
  const rejected: RejectedEvent[] = []

  envelope.output.events.forEach((candidate, index) => {
    const parsed = v.safeParse(eventSchema, candidate)
    if (!parsed.success) {
      rejected.push({ index, code: rejectionCodeForField(firstIssueField(parsed.issues)) })
      return
    }

    const { value, truncated } = truncateToUtf8Bytes(parsed.output.message, MAX_MESSAGE_BYTES)
    accepted.push({
      index,
      event: truncated ? { ...parsed.output, message: value } : parsed.output,
      messageTruncated: truncated,
    })
  })

  return {
    ok: true,
    batch: {
      schemaVersion: envelope.output.schemaVersion,
      batchId: envelope.output.batchId,
      sdk: envelope.output.sdk,
      resource: {
        ...envelope.output.resource,
        service: envelope.output.resource.service ?? DEFAULT_SERVICE,
      },
      accepted,
      rejected,
    },
  }
}
