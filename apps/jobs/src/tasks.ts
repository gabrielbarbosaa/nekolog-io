import type { BlobStore, LogStore, QuotaStore, UsageStore } from '@internal/adapters'
import { registerTasks } from './schedule.ts'
import type { Task } from './task.ts'
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
  ])
}
