import type { BlobStore, LogStore } from '@internal/adapters'
import {
  deduplicationTokenFor,
  encodeSpoolEnvelope,
  SPOOL_CONTENT_TYPE,
  spoolKey,
} from '@internal/spool'
import type { BatchSink } from './app.ts'
import { countryOf, rowsFor } from './rows.ts'

export type SpooledBatch = {
  key: string
  rows: number
  reason: unknown
}

export type LogStoreSinkOptions = {
  logStore: LogStore
  spool?: BlobStore
  deduplicate?: boolean
  now?: () => number
  onSpooled?: (spooled: SpooledBatch) => void
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createLogStoreSink(options: LogStoreSinkOptions): BatchSink {
  const { logStore, spool } = options

  return async (batch, principal, context) => {
    if (batch.accepted.length === 0) {
      return
    }

    const rows = rowsFor(batch, principal, {
      receivedAt: context.receivedAt,
      country: countryOf(context.request),
    })
    const token = deduplicationTokenFor(principal.environmentId, batch.batchId)

    try {
      await logStore.insert(
        rows,
        options.deduplicate === false ? undefined : { deduplicationToken: token },
      )
      return
    } catch (error) {
      if (spool === undefined) {
        throw error
      }

      const spooledAt = (options.now ?? Date.now)()
      const key = spoolKey(spooledAt, batch.batchId)

      try {
        await spool.put(
          key,
          encodeSpoolEnvelope({
            spooledAt,
            batchId: batch.batchId,
            projectId: principal.projectId,
            environmentId: principal.environmentId,
            deduplicationToken: token,
            rows,
          }),
          SPOOL_CONTENT_TYPE,
        )
      } catch (spoolError) {
        throw new Error(
          `The batch reached neither ClickHouse (${describe(error)}) nor the spool (${describe(spoolError)})`,
          { cause: error },
        )
      }

      try {
        options.onSpooled?.({ key, rows: rows.length, reason: error })
      } catch {
        return
      }
    }
  }
}
