import { SpoolFormatError } from './errors.ts'

export const SPOOL_PREFIX = 'spool/'

export const QUARANTINE_PREFIX = 'quarantine/'

export const SPOOL_SUFFIX = '.json'

export const TIMESTAMP_DIGITS = 13

const SAFE_BATCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function assertSafeBatchId(batchId: string): string {
  if (!SAFE_BATCH_ID.test(batchId)) {
    throw new SpoolFormatError(`A spool key needs a plain UUID as batchId, got "${batchId}"`)
  }
  return batchId
}

export function spoolKey(spooledAt: number, batchId: string): string {
  if (!Number.isInteger(spooledAt) || spooledAt < 0) {
    throw new Error(`A spool key needs a whole millisecond timestamp, got ${spooledAt}`)
  }
  const stamp = String(spooledAt).padStart(TIMESTAMP_DIGITS, '0')
  if (stamp.length > TIMESTAMP_DIGITS) {
    throw new Error(`A spool key timestamp may not exceed ${TIMESTAMP_DIGITS} digits`)
  }
  return `${SPOOL_PREFIX}${stamp}-${assertSafeBatchId(batchId)}${SPOOL_SUFFIX}`
}

export type SpoolKeyParts = {
  spooledAt: number
  batchId: string
}

export function parseSpoolKey(key: string): SpoolKeyParts | null {
  if (!key.startsWith(SPOOL_PREFIX) || !key.endsWith(SPOOL_SUFFIX)) {
    return null
  }
  const middle = key.slice(SPOOL_PREFIX.length, key.length - SPOOL_SUFFIX.length)
  const stamp = middle.slice(0, TIMESTAMP_DIGITS)
  const batchId = middle.slice(TIMESTAMP_DIGITS + 1)

  if (!/^[0-9]{13}$/.test(stamp) || middle[TIMESTAMP_DIGITS] !== '-') {
    return null
  }
  if (!SAFE_BATCH_ID.test(batchId)) {
    return null
  }
  return { spooledAt: Number(stamp), batchId }
}

export function quarantineKeyFor(spoolKey: string): string {
  if (!spoolKey.startsWith(SPOOL_PREFIX)) {
    throw new Error(`Only a spool key can be quarantined, got "${spoolKey}"`)
  }
  return `${QUARANTINE_PREFIX}${spoolKey.slice(SPOOL_PREFIX.length)}`
}
