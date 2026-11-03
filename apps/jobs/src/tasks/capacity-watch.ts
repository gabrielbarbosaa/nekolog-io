import { SPOOL_PREFIX } from '@internal/spool'
import type { BlobStore } from '@nekolog-io/adapters'
import type { Task } from '../task.ts'

export const CAPACITY_WATCH_TASK = 'capacity-watch'

export const DEFAULT_SPOOL_WARNING = 100

export const DEFAULT_DISK_WARNING_RATIO = 0.15

export const SPOOL_SAMPLE_LIMIT = 1_000

export type DiskReading = {
  name: string
  freeBytes: number
  totalBytes: number
}

export type DiskReader = (signal: AbortSignal) => Promise<DiskReading[]>

export type CapacityAlert =
  | { kind: 'spool-backlog'; pending: number; threshold: number; capped: boolean }
  | { kind: 'disk-low'; disk: string; freeRatio: number; threshold: number }
  | { kind: 'unreadable'; what: 'spool' | 'disk'; why: string }

export type CapacityReport = {
  pending: number
  capped: boolean
  disks: Array<{ name: string; freeRatio: number }>
  alerts: number
}

export type CapacityWatchOptions = {
  spool: BlobStore
  readDisks?: DiskReader
  spoolWarning?: number
  diskWarningRatio?: number
  everyMinutes?: number
  onAlert?: (alert: CapacityAlert) => void
}

function why(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function freeRatioOf(disk: DiskReading): number {
  return disk.totalBytes > 0 ? disk.freeBytes / disk.totalBytes : 0
}

export function capacityWatchTask(options: CapacityWatchOptions): Task {
  const spoolWarning = options.spoolWarning ?? DEFAULT_SPOOL_WARNING
  const diskWarning = options.diskWarningRatio ?? DEFAULT_DISK_WARNING_RATIO
  const announce = options.onAlert ?? (() => undefined)

  return {
    name: CAPACITY_WATCH_TASK,
    everyMinutes: options.everyMinutes ?? 5,
    async run({ signal }) {
      let alerts = 0
      let pending = 0
      let capped = false

      try {
        const listed = await options.spool.list(SPOOL_PREFIX, SPOOL_SAMPLE_LIMIT)
        pending = listed.length
        capped = pending >= SPOOL_SAMPLE_LIMIT
        if (pending >= spoolWarning) {
          alerts += 1
          announce({ kind: 'spool-backlog', pending, threshold: spoolWarning, capped })
        }
      } catch (error) {
        alerts += 1
        announce({ kind: 'unreadable', what: 'spool', why: why(error) })
      }

      const disks: Array<{ name: string; freeRatio: number }> = []

      if (options.readDisks !== undefined) {
        try {
          for (const disk of await options.readDisks(signal)) {
            const freeRatio = freeRatioOf(disk)
            disks.push({ name: disk.name, freeRatio })
            if (freeRatio < diskWarning) {
              alerts += 1
              announce({
                kind: 'disk-low',
                disk: disk.name,
                freeRatio,
                threshold: diskWarning,
              })
            }
          }
        } catch (error) {
          alerts += 1
          announce({ kind: 'unreadable', what: 'disk', why: why(error) })
        }
      }

      return { pending, capped, disks, alerts } satisfies CapacityReport
    },
  }
}
