import type {
  BlobStore,
  ExportStore,
  IssueStore,
  LogStore,
  QuotaStore,
  UsageStore,
} from '@nekolog-io/adapters'
import type { ExportDestination } from '@nekolog-io/clickhouse/export'
import { registerTasks } from './schedule.ts'
import type { Task } from './task.ts'
import { type CapacityAlert, capacityWatchTask, type DiskReader } from './tasks/capacity-watch.ts'
import { type ExportRunEvent, type ExportWriter, exportRunTask } from './tasks/export-run.ts'
import { type IssueSourceLike, issueRollupTask } from './tasks/issue-rollup.ts'
import { type QuotaBlockEvent, quotaBlockTask } from './tasks/quota-block.ts'
import { type SpoolResendEvent, spoolResendTask } from './tasks/spool-resend.ts'

export type TaskDeps = {
  spool: BlobStore
  logStore: LogStore
  usage: UsageStore
  quotas: QuotaStore
  dailyQuota?: number
  issueSource?: IssueSourceLike
  issues?: IssueStore
  onSpoolEvent?: (event: SpoolResendEvent) => void
  onQuotaEvent?: (event: QuotaBlockEvent) => void
  readDisks?: DiskReader
  onCapacityAlert?: (alert: CapacityAlert) => void
  exports?: ExportStore
  exportWriter?: ExportWriter
  exportDestination?: ExportDestination
  exportObjects?: BlobStore
  clickHouseDatabase?: string
  onExportEvent?: (event: ExportRunEvent) => void
}

export function buildTasks(deps: TaskDeps): readonly Task[] {
  const grouping =
    deps.issueSource === undefined || deps.issues === undefined
      ? []
      : [issueRollupTask({ source: deps.issueSource, issues: deps.issues })]

  const exporting =
    deps.exports === undefined ||
    deps.exportWriter === undefined ||
    deps.exportDestination === undefined ||
    deps.exportObjects === undefined ||
    deps.clickHouseDatabase === undefined
      ? []
      : [
          exportRunTask({
            exports: deps.exports,
            write: deps.exportWriter,
            destination: deps.exportDestination,
            objects: deps.exportObjects,
            database: deps.clickHouseDatabase,
            ...(deps.onExportEvent === undefined ? {} : { onEvent: deps.onExportEvent }),
          }),
        ]

  return registerTasks([
    ...grouping,
    ...exporting,
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
