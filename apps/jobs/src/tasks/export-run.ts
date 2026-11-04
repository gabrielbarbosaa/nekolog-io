import type { BlobStore, ExportStore, PendingExport } from '@nekolog-io/adapters'
import { compileExport, type ExportDestination } from '@nekolog-io/clickhouse/export'
import type { Task, TaskContext } from '../task.ts'

export const EXPORT_RUN_TASK = 'export-run'

export const DEFAULT_EXPORTS_PER_RUN = 2
export const MAX_EXPIRIES_PER_RUN = 50

export type ExportWriterResult = {
  rows: number
  bytes: number
}

export type ExportWriter = (
  sql: string,
  params: Record<string, string>,
) => Promise<ExportWriterResult>

export type ExportRunEvent =
  | { kind: 'ready'; id: string; objectKey: string; rows: number; bytes: number }
  | { kind: 'failed'; id: string; reason: string }
  | { kind: 'expired'; objectKey: string; deleted: boolean }

export type ExportRunReport = {
  claimed: number
  ready: number
  failed: number
  expired: number
  stopped: 'finished' | 'store_unavailable' | 'out_of_time'
}

export type ExportRunOptions = {
  exports: ExportStore
  write: ExportWriter
  destination: ExportDestination
  database: string
  perRun?: number
  objects?: BlobStore
  now?: () => number
  onEvent?: (event: ExportRunEvent) => void
}

export const MAX_FAILURE_CHARS = 500

export const EMPTY_GZIP: Uint8Array = new Uint8Array([
  0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
])

export function reasonFrom(error: unknown, secrets: readonly string[]): string {
  const message = error instanceof Error ? error.message : String(error)
  let safe = message
  for (const secret of secrets) {
    if (secret !== '') {
      safe = safe.split(secret).join('[redacted]')
    }
  }
  return safe.slice(0, MAX_FAILURE_CHARS)
}

export function exportRunTask(options: ExportRunOptions): Task {
  const perRun = options.perRun ?? DEFAULT_EXPORTS_PER_RUN
  const now = options.now ?? Date.now
  const secrets = [options.destination.secretAccessKey, options.destination.accessKeyId]

  async function runOne(one: PendingExport, report: ExportRunReport): Promise<void> {
    let compiled: ReturnType<typeof compileExport>

    try {
      compiled = compileExport({
        exportId: one.id,
        format: one.format,
        scope: {
          projectId: one.projectId,
          environmentIds: [one.environmentId],
          from: new Date(one.rangeFrom),
          to: new Date(one.rangeTo),
        },
        search: one.query,
        destination: options.destination,
        target: { database: options.database },
      })
    } catch (error) {
      report.failed += 1
      const reason = reasonFrom(error, secrets)
      await options.exports.markFailed(one.id, reason, now())
      options.onEvent?.({ kind: 'failed', id: one.id, reason })
      return
    }

    try {
      const written = await options.write(compiled.sql, compiled.params)

      if (written.rows === 0) {
        if (options.objects === undefined) {
          throw new Error(
            'This export matched no rows, and ClickHouse writes no object for an empty result, ' +
              'so there is nothing to download; the task needs an object store to place an empty file',
          )
        }
        await options.objects.put(compiled.objectKey, EMPTY_GZIP, 'application/gzip')
      }

      report.ready += 1
      await options.exports.markReady(
        one.id,
        { objectKey: compiled.objectKey, byteSize: written.bytes, rowCount: written.rows },
        now(),
      )
      options.onEvent?.({
        kind: 'ready',
        id: one.id,
        objectKey: compiled.objectKey,
        rows: written.rows,
        bytes: written.bytes,
      })
    } catch (error) {
      report.failed += 1
      const reason = reasonFrom(error, secrets)
      await options.exports.markFailed(one.id, reason, now())
      options.onEvent?.({ kind: 'failed', id: one.id, reason })
    }
  }

  return {
    name: EXPORT_RUN_TASK,
    everyMinutes: 1,

    async run(context: TaskContext): Promise<ExportRunReport> {
      const report: ExportRunReport = {
        claimed: 0,
        ready: 0,
        failed: 0,
        expired: 0,
        stopped: 'finished',
      }

      let claimed: ReadonlyArray<PendingExport>
      try {
        claimed = await options.exports.claim(perRun, context.scheduledAt)
      } catch {
        report.stopped = 'store_unavailable'
        return report
      }

      report.claimed = claimed.length

      for (const one of claimed) {
        if (context.signal.aborted) {
          report.stopped = 'out_of_time'
          return report
        }
        await runOne(one, report)
      }

      if (context.signal.aborted) {
        report.stopped = 'out_of_time'
        return report
      }

      let due: ReadonlyArray<string>
      try {
        due = await options.exports.expire(context.scheduledAt, MAX_EXPIRIES_PER_RUN)
      } catch {
        report.stopped = 'store_unavailable'
        return report
      }

      report.expired = due.length

      for (const objectKey of due) {
        let deleted = false
        try {
          await options.objects?.delete(objectKey)
          deleted = options.objects !== undefined
        } catch {
          deleted = false
        }
        options.onEvent?.({ kind: 'expired', objectKey, deleted })
      }

      return report
    },
  }
}
