import type { LogStore } from '@internal/adapters'
import type { BatchSink } from './app.ts'
import { countryOf, rowsFor } from './rows.ts'

export type LogStoreSinkOptions = {
  logStore: LogStore
  deduplicate?: boolean
}

export function createLogStoreSink(options: LogStoreSinkOptions): BatchSink {
  const { logStore } = options

  return (batch, principal, context) => {
    if (batch.accepted.length === 0) {
      return undefined
    }

    const rows = rowsFor(batch, principal, {
      receivedAt: context.receivedAt,
      country: countryOf(context.request),
    })

    return logStore.insert(
      rows,
      options.deduplicate === false ? undefined : { deduplicationToken: batch.batchId },
    )
  }
}
