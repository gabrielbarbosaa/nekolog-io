import type { BlobStore, LogStore, QuotaStore, UsageStore } from '@nekolog-io/adapters'
import { registerTasks } from './schedule.ts'
import type { Task } from './task.ts'
import { type CapacityAlert, capacityWatchTask, type DiskReader } from './tasks/capacity-watch.ts'
import { type QuotaBlockEvent, quotaBlockTask } from './tasks/quota-block.ts'
import { type SpoolResendEvent, spoolResendTask } from './tasks/spool-resend.ts'

export type TaskDeps = {
  spool: BlobStore
  logStore: LogStore
  usage: UsageStore
  quotas: QuotaStore
  dailyQuota?: number
  onSpoolEvent?: (event: SpoolResendEvent) => void
  onQuotaEvent?: (event: QuotaBlockEvent) => void
  readDisks?: DiskReader
  onCapacityAlert?: (alert: CapacityAlert) => void
}

export function buildTasks(deps: TaskDeps): readonly Task[] {
  return registerTasks([
    spoolResendTask({
      spool: deps.spool,
      logStore: deps.logStore,
      ...(deps.onSpoolEvent === undefined ? {} : { onEvent: deps.onSpoolEvent }),
    }),
    quotaBlockTask({
      usage: deps.usage,
      quotas: deps.quotas,
      ...(deps.dailyQuota === undefined ? {} : { dailyQuota: deps.dailyQuota }),
      ...(deps.onQuotaEvent === undefined ? {} : { onEvent: deps.onQuotaEvent }),
    }),
    capacityWatchTask({
      spool: deps.spool,
      ...(deps.readDisks === undefined ? {} : { readDisks: deps.readDisks }),
      ...(deps.onCapacityAlert === undefined ? {} : { onAlert: deps.onCapacityAlert }),
    }),
  ])
}
