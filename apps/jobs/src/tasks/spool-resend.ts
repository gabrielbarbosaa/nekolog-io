import type { BlobStore, LogStore } from '@internal/adapters'
import {
  decodeSpoolEnvelope,
  parseSpoolKey,
  quarantineKeyFor,
  SPOOL_CONTENT_TYPE,
  SPOOL_PREFIX,
} from '@internal/spool'
import type { Task, TaskContext } from '../task.ts'

export const SPOOL_RESEND_TASK = 'spool-resend'

export const DEFAULT_FILES_PER_RUN = 50

export const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export type SpoolResendStop = 'clickhouse_down' | 'out_of_time' | 'finished'

export type SpoolResendReport = {
  resent: number
  rows: number
  quarantined: number
  undeleted: number
  stopped: SpoolResendStop
}

export type SpoolResendEvent =
  | { kind: 'resent'; key: string; rows: number }
  | { kind: 'quarantined'; key: string; why: string }
  | { kind: 'undeleted'; key: string; error: unknown }
  | { kind: 'blocked'; key: string; error: unknown }

export type SpoolResendOptions = {
  spool: BlobStore
  logStore: LogStore
  filesPerRun?: number
  maxAgeMs?: number
  now?: () => number
  onEvent?: (event: SpoolResendEvent) => void
}

export function isPermanentInsertError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status
  return status === 400
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function spoolResendTask(options: SpoolResendOptions): Task {
  const now = options.now ?? Date.now
  const filesPerRun = options.filesPerRun ?? DEFAULT_FILES_PER_RUN
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS

  const report = (event: SpoolResendEvent): void => {
    try {
      options.onEvent?.(event)
    } catch {
      return
    }
  }

  const quarantine = async (key: string, body: Uint8Array, why: string): Promise<boolean> => {
    try {
      await options.spool.put(quarantineKeyFor(key), body, SPOOL_CONTENT_TYPE)
      await options.spool.delete(key)
      report({ kind: 'quarantined', key, why })
      return true
    } catch {
      return false
    }
  }

  return {
    name: SPOOL_RESEND_TASK,
    everyMinutes: 1,

    async run(context: TaskContext): Promise<SpoolResendReport> {
      const result: SpoolResendReport = {
        resent: 0,
        rows: 0,
        quarantined: 0,
        undeleted: 0,
        stopped: 'finished',
      }

      const keys = await options.spool.list(SPOOL_PREFIX, filesPerRun)

      for (const key of keys) {
        if (context.signal.aborted) {
          result.stopped = 'out_of_time'
          return result
        }
        const body = await options.spool.get(key)
        if (body === null) {
          continue
        }

        const parts = parseSpoolKey(key)
        if (parts === null) {
          if (await quarantine(key, body, 'the key is not a spool key')) {
            result.quarantined += 1
          }
          continue
        }
        if (now() - parts.spooledAt > maxAgeMs) {
          if (await quarantine(key, body, 'older than the retention window')) {
            result.quarantined += 1
          }
          continue
        }

        let envelope: ReturnType<typeof decodeSpoolEnvelope>
        try {
          envelope = decodeSpoolEnvelope(body)
        } catch (error) {
          if (await quarantine(key, body, reason(error))) {
            result.quarantined += 1
          }
          continue
        }

        try {
          await options.logStore.insert(envelope.rows, {
            deduplicationToken: envelope.deduplicationToken,
          })
        } catch (error) {
          if (isPermanentInsertError(error)) {
            if (await quarantine(key, body, reason(error))) {
              result.quarantined += 1
            }
            continue
          }
          report({ kind: 'blocked', key, error })
          result.stopped = 'clickhouse_down'
          return result
        }

        result.resent += 1
        result.rows += envelope.rows.length

        try {
          await options.spool.delete(key)
        } catch (error) {
          result.undeleted += 1
          report({ kind: 'undeleted', key, error })
        }

        report({ kind: 'resent', key, rows: envelope.rows.length })
      }

      return result
    },
  }
}
