import type { ExportOutcome, ExportStatus, ExportStore, PendingExport } from '../export-store.ts'
import { DEFAULT_STALE_AFTER_MS } from './sql-export-store.ts'

export type MemoryExport = PendingExport & {
  status: ExportStatus
  objectKey?: string
  byteSize?: number
  rowCount?: number
  failure?: string
  startedAt?: number
  finishedAt?: number
  expiresAt: number
  createdAt: number
}

export interface MemoryExportStore extends ExportStore {
  readonly rows: Map<string, MemoryExport>
  add(one: MemoryExport): void
}

export function memoryExportStore(
  staleAfterMs: number = DEFAULT_STALE_AFTER_MS,
): MemoryExportStore {
  const rows = new Map<string, MemoryExport>()

  return {
    rows,

    add(one: MemoryExport): void {
      rows.set(one.id, { ...one })
    },

    async claim(limit: number, now: number): Promise<ReadonlyArray<PendingExport>> {
      if (limit <= 0) {
        return []
      }

      const ready = [...rows.values()]
        .filter(
          (one) =>
            one.status === 'pending' ||
            (one.status === 'running' && (one.startedAt ?? 0) < now - staleAfterMs),
        )
        .sort((left, right) => left.createdAt - right.createdAt)
        .slice(0, limit)

      return ready.map((one) => {
        one.status = 'running'
        one.startedAt = now
        return {
          id: one.id,
          projectId: one.projectId,
          environmentId: one.environmentId,
          format: one.format,
          query: one.query,
          rangeFrom: one.rangeFrom,
          rangeTo: one.rangeTo,
        }
      })
    },

    async markReady(id: string, outcome: ExportOutcome, at: number): Promise<void> {
      const found = rows.get(id)
      if (found === undefined || found.status !== 'running') {
        return
      }
      found.status = 'ready'
      found.objectKey = outcome.objectKey
      found.byteSize = outcome.byteSize
      found.rowCount = outcome.rowCount
      found.failure = undefined
      found.finishedAt = at
    },

    async markFailed(id: string, reason: string, at: number): Promise<void> {
      const found = rows.get(id)
      if (found === undefined || found.status !== 'running') {
        return
      }
      found.status = 'failed'
      found.failure = reason
      found.finishedAt = at
    },

    async expire(now: number, limit: number): Promise<ReadonlyArray<string>> {
      if (limit <= 0) {
        return []
      }

      const due = [...rows.values()]
        .filter((one) => one.status === 'ready' && one.expiresAt <= now)
        .sort((left, right) => left.expiresAt - right.expiresAt)
        .slice(0, limit)

      const keys: string[] = []
      for (const one of due) {
        one.status = 'expired'
        if (one.objectKey !== undefined && one.objectKey !== '') {
          keys.push(one.objectKey)
        }
      }
      return keys
    },
  }
}
