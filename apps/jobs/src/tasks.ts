import type {
  AlertChannelStore,
  AlertNoticeStore,
  AlertRuleStore,
  BlobStore,
  ExportScheduleStore,
  ExportStore,
  IssueStore,
  LogStore,
  Mailer,
  QuotaStore,
  UsageStore,
} from '@nekolog-io/adapters'
import type { AlertTarget } from '@nekolog-io/clickhouse/alerts'
import type { BackupDestination } from '@nekolog-io/clickhouse/backup'
import type { ExportDestination } from '@nekolog-io/clickhouse/export'
import type { DeliveryOptions } from './alerts/deliver.ts'
import { registerTasks } from './schedule.ts'
import type { Task } from './task.ts'
import {
  type AlertEvaluateEvent,
  type AlertMeasurer,
  alertEvaluateTask,
  type IssueActivitySource,
} from './tasks/alert-evaluate.ts'
import { type AlertNotifyEvent, alertNotifyTask } from './tasks/alert-notify.ts'
import { type CapacityAlert, capacityWatchTask, type DiskReader } from './tasks/capacity-watch.ts'
import {
  type BackupHistoryReader,
  type BackupStarter,
  type ClickHouseBackupAlert,
  clickHouseBackupTask,
} from './tasks/clickhouse-backup.ts'
import { type ExportNotifyEvent, exportNotifyTask } from './tasks/export-notify.ts'
import { type ExportRunEvent, type ExportWriter, exportRunTask } from './tasks/export-run.ts'
import { type ExportScheduleEvent, exportScheduleTask } from './tasks/export-schedule.ts'
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
  exportSchedules?: ExportScheduleStore
  newExportId?: () => string
  onExportScheduleEvent?: (event: ExportScheduleEvent) => void
  mailer?: Mailer
  dashboardUrl?: string
  onExportNotifyEvent?: (event: ExportNotifyEvent) => void
  alertRules?: AlertRuleStore
  measureAlerts?: AlertMeasurer
  alertTarget?: AlertTarget
  issueActivity?: IssueActivitySource
  onAlertEvent?: (event: AlertEvaluateEvent) => void
  alertNotices?: AlertNoticeStore
  alertChannels?: AlertChannelStore
  alertDelivery?: DeliveryOptions
  onAlertNotifyEvent?: (event: AlertNotifyEvent) => void
  backupDestination?: BackupDestination
  backupHistory?: BackupHistoryReader
  startBackup?: BackupStarter
  onBackupAlert?: (alert: ClickHouseBackupAlert) => void
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

  const scheduling =
    deps.exportSchedules === undefined || deps.newExportId === undefined
      ? []
      : [
          exportScheduleTask({
            schedules: deps.exportSchedules,
            newExportId: deps.newExportId,
            ...(deps.onExportScheduleEvent === undefined
              ? {}
              : { onEvent: deps.onExportScheduleEvent }),
          }),
        ]

  const notifying =
    deps.exports === undefined || deps.mailer === undefined || deps.dashboardUrl === undefined
      ? []
      : [
          exportNotifyTask({
            exports: deps.exports,
            mailer: deps.mailer,
            dashboardUrl: deps.dashboardUrl,
            ...(deps.onExportNotifyEvent === undefined
              ? {}
              : { onEvent: deps.onExportNotifyEvent }),
          }),
        ]

  const alerting =
    deps.alertRules === undefined ||
    deps.measureAlerts === undefined ||
    deps.alertTarget === undefined
      ? []
      : [
          alertEvaluateTask({
            rules: deps.alertRules,
            measure: deps.measureAlerts,
            target: deps.alertTarget,
            ...(deps.issueActivity === undefined ? {} : { issueActivity: deps.issueActivity }),
            ...(deps.onAlertEvent === undefined ? {} : { onEvent: deps.onAlertEvent }),
          }),
        ]

  const notifying_alerts =
    deps.alertNotices === undefined ||
    deps.alertChannels === undefined ||
    deps.alertDelivery === undefined
      ? []
      : [
          alertNotifyTask({
            notices: deps.alertNotices,
            channels: deps.alertChannels,
            delivery: deps.alertDelivery,
            ...(deps.onAlertNotifyEvent === undefined ? {} : { onEvent: deps.onAlertNotifyEvent }),
          }),
        ]

  const backing =
    deps.backupDestination === undefined ||
    deps.backupHistory === undefined ||
    deps.startBackup === undefined ||
    deps.clickHouseDatabase === undefined
      ? []
      : [
          clickHouseBackupTask({
            database: deps.clickHouseDatabase,
            destination: deps.backupDestination,
            history: deps.backupHistory,
            start: deps.startBackup,
            ...(deps.onBackupAlert === undefined ? {} : { onAlert: deps.onBackupAlert }),
          }),
        ]

  return registerTasks([
    ...backing,
    ...alerting,
    ...notifying_alerts,
    ...grouping,
    ...exporting,
    ...scheduling,
    ...notifying,
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
