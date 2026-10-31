import { SpoolFormatError } from './errors.ts'
import { assertSafeBatchId } from './key.ts'

export const SPOOL_VERSION = 1

export const SPOOL_CONTENT_TYPE = 'application/json'

export type SpoolRow = Record<string, unknown>

export type SpoolEnvelope = {
  spoolVersion: number
  spooledAt: number
  batchId: string
  projectId: string
  environmentId: string
  deduplicationToken: string
  rows: ReadonlyArray<SpoolRow>
}

export type NewSpoolEnvelope = Omit<SpoolEnvelope, 'spoolVersion'>

export function encodeSpoolEnvelope(envelope: NewSpoolEnvelope): string {
  assertSafeBatchId(envelope.batchId)
  return JSON.stringify({ spoolVersion: SPOOL_VERSION, ...envelope })
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new SpoolFormatError(`A spooled batch needs a non-empty ${field}`)
  }
  return value
}

export function decodeSpoolEnvelope(raw: Uint8Array | string): SpoolEnvelope {
  const source =
    typeof raw === 'string' ? raw : new TextDecoder('utf-8', { fatal: true }).decode(raw)

  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    throw new SpoolFormatError(`A spooled batch is not JSON: ${(error as Error).message}`)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SpoolFormatError('A spooled batch must be a JSON object')
  }

  const candidate = parsed as Record<string, unknown>
  if (candidate.spoolVersion !== SPOOL_VERSION) {
    throw new SpoolFormatError(
      `A spooled batch of version ${String(candidate.spoolVersion)} cannot be read by version ${SPOOL_VERSION}`,
    )
  }

  const spooledAt = candidate.spooledAt
  if (typeof spooledAt !== 'number' || !Number.isInteger(spooledAt) || spooledAt < 0) {
    throw new SpoolFormatError('A spooled batch needs a whole millisecond spooledAt')
  }

  const rows = candidate.rows
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new SpoolFormatError('A spooled batch needs at least one row')
  }
  for (const row of rows) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      throw new SpoolFormatError('A spooled row must be a JSON object')
    }
  }

  return {
    spoolVersion: SPOOL_VERSION,
    spooledAt,
    batchId: assertSafeBatchId(text(candidate.batchId, 'batchId')),
    projectId: text(candidate.projectId, 'projectId'),
    environmentId: text(candidate.environmentId, 'environmentId'),
    deduplicationToken: text(candidate.deduplicationToken, 'deduplicationToken'),
    rows: rows as SpoolRow[],
  }
}

export function deduplicationTokenFor(environmentId: string, batchId: string): string {
  return `${environmentId}:${assertSafeBatchId(batchId)}`
}
