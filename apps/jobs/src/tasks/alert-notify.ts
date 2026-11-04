import type {
  AlertChannel,
  AlertChannelStore,
  AlertNoticeStore,
  PendingAlert,
} from '@nekolog-io/adapters'
import { type DeliveryOptions, deliver } from '../alerts/deliver.ts'
import type { Task, TaskContext } from '../task.ts'

export const ALERT_NOTIFY_TASK = 'alert-notify'

export const MAX_ALERTS_PER_RUN = 10
export const MAX_WHY_CHARS = 300

export type AlertNotifyEvent =
  | { kind: 'sent'; ruleId: string; channelId: string; channelKind: string }
  | { kind: 'not_sent'; ruleId: string; channelId: string; why: string }
  | { kind: 'no_channel'; ruleId: string }

export type AlertNotifyReport = {
  waiting: number
  sent: number
  failed: number
  stopped: 'finished' | 'store_unavailable' | 'out_of_time'
}

export type AlertNotifyOptions = {
  notices: AlertNoticeStore
  channels: AlertChannelStore
  delivery: DeliveryOptions
  perRun?: number
  now?: () => number
  onEvent?: (event: AlertNotifyEvent) => void
}

function why(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, MAX_WHY_CHARS)
}

export function alertNotifyTask(options: AlertNotifyOptions): Task {
  const perRun = options.perRun ?? MAX_ALERTS_PER_RUN
  const now = options.now ?? Date.now

  async function notify(alert: PendingAlert, report: AlertNotifyReport): Promise<void> {
    let channels: ReadonlyArray<AlertChannel>
    try {
      channels = await options.channels.byIds(alert.projectId, alert.channels)
    } catch (error) {
      report.failed += 1
      options.onEvent?.({ kind: 'not_sent', ruleId: alert.ruleId, channelId: '', why: why(error) })
      return
    }

    if (channels.length === 0) {
      options.onEvent?.({ kind: 'no_channel', ruleId: alert.ruleId })
      await options.notices.markNotified(alert.ruleId, now(), alert.changedAt)
      return
    }

    let delivered = 0

    for (const channel of channels) {
      try {
        await deliver(alert, channel, options.delivery)
        delivered += 1
        options.onEvent?.({
          kind: 'sent',
          ruleId: alert.ruleId,
          channelId: channel.id,
          channelKind: channel.kind,
        })
      } catch (error) {
        report.failed += 1
        options.onEvent?.({
          kind: 'not_sent',
          ruleId: alert.ruleId,
          channelId: channel.id,
          why: why(error),
        })
      }
    }

    if (delivered > 0) {
      report.sent += delivered
      await options.notices.markNotified(alert.ruleId, now(), alert.changedAt)
    }
  }

  return {
    name: ALERT_NOTIFY_TASK,
    everyMinutes: 1,

    async run(context: TaskContext): Promise<AlertNotifyReport> {
      const report: AlertNotifyReport = {
        waiting: 0,
        sent: 0,
        failed: 0,
        stopped: 'finished',
      }

      let waiting: ReadonlyArray<PendingAlert>
      try {
        waiting = await options.notices.awaitingNotice(perRun)
      } catch {
        report.stopped = 'store_unavailable'
        return report
      }

      report.waiting = waiting.length

      for (const alert of waiting) {
        if (context.signal.aborted) {
          report.stopped = 'out_of_time'
          return report
        }
        await notify(alert, report)
      }

      return report
    },
  }
}
