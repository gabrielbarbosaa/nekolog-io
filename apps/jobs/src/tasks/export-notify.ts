import type { ExportNotice, ExportStore, Mailer } from '@nekolog-io/adapters'
import { exportReadyEmail } from '../mail/export-ready.ts'
import type { Task, TaskContext } from '../task.ts'

export const EXPORT_NOTIFY_TASK = 'export-notify'

export const MAX_NOTICES_PER_RUN = 20

export type ExportNotifyEvent =
  | { kind: 'sent'; id: string; locale: string }
  | { kind: 'not_sent'; id: string; why: string }

export type ExportNotifyReport = {
  waiting: number
  sent: number
  failed: number
  stopped: 'finished' | 'store_unavailable' | 'out_of_time'
}

export type ExportNotifyOptions = {
  exports: ExportStore
  mailer: Mailer
  dashboardUrl: string
  perRun?: number
  now?: () => number
  onEvent?: (event: ExportNotifyEvent) => void
}

function why(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200)
}

export function exportNotifyTask(options: ExportNotifyOptions): Task {
  const perRun = options.perRun ?? MAX_NOTICES_PER_RUN
  const now = options.now ?? Date.now

  return {
    name: EXPORT_NOTIFY_TASK,
    everyMinutes: 1,

    async run(context: TaskContext): Promise<ExportNotifyReport> {
      const report: ExportNotifyReport = {
        waiting: 0,
        sent: 0,
        failed: 0,
        stopped: 'finished',
      }

      let waiting: ReadonlyArray<ExportNotice>
      try {
        waiting = await options.exports.awaitingNotice(perRun)
      } catch {
        report.stopped = 'store_unavailable'
        return report
      }

      report.waiting = waiting.length

      for (const notice of waiting) {
        if (context.signal.aborted) {
          report.stopped = 'out_of_time'
          return report
        }

        try {
          const email = exportReadyEmail(notice, options.dashboardUrl)
          await options.mailer.send({
            to: notice.email,
            subject: email.subject,
            html: email.html,
            text: email.text,
          })
        } catch (error) {
          report.failed += 1
          options.onEvent?.({ kind: 'not_sent', id: notice.id, why: why(error) })
          continue
        }

        await options.exports.markNotified(notice.id, now())
        report.sent += 1
        options.onEvent?.({ kind: 'sent', id: notice.id, locale: notice.locale })
      }

      return report
    },
  }
}
