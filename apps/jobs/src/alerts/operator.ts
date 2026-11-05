import { assertWebhookTarget } from '@nekolog-io/adapters'
import type { CapacityAlert } from '../tasks/capacity-watch.ts'
import type { ClickHouseBackupAlert } from '../tasks/clickhouse-backup.ts'
import type { QuotaBlockEvent } from '../tasks/quota-block.ts'
import type { SpoolResendEvent } from '../tasks/spool-resend.ts'
import type { Fetcher } from './deliver.ts'

export const OPERATOR_TIMEOUT_MS = 5000
export const MAX_OPERATOR_DETAIL_CHARS = 300

export const OPERATOR_SEVERITIES = ['warning', 'critical'] as const
export type OperatorSeverity = (typeof OPERATOR_SEVERITIES)[number]

export type OperatorAlert = {
  severity: OperatorSeverity
  kind: string
  headline: string
  detail: string
}

export type OperatorChannel = {
  webhookUrl?: string
  fetch?: Fetcher
  environment?: string
  timeoutMs?: number
  onWrite?: (alert: OperatorAlert) => void
  onUndelivered?: (alert: OperatorAlert, why: string) => void
}

function trim(value: string): string {
  return value.slice(0, MAX_OPERATOR_DETAIL_CHARS)
}

export function capacityAlert(alert: CapacityAlert): OperatorAlert {
  if (alert.kind === 'spool-backlog') {
    return {
      severity: 'warning',
      kind: 'spool-backlog',
      headline: 'The spool is filling up',
      detail: trim(
        `${alert.pending} file(s) waiting against a threshold of ${alert.threshold}${
          alert.capped ? ', and the listing was capped' : ''
        }`,
      ),
    }
  }

  if (alert.kind === 'disk-low') {
    return {
      severity: 'critical',
      kind: 'disk-low',
      headline: 'A ClickHouse disk is running out',
      detail: trim(
        `${alert.disk} has ${(alert.freeRatio * 100).toFixed(1)}% free against a floor of ${(
          alert.threshold * 100
        ).toFixed(1)}%`,
      ),
    }
  }

  return {
    severity: 'critical',
    kind: 'capacity-unreadable',
    headline: `Cannot read the ${alert.what}`,
    detail: trim(alert.why),
  }
}

export function backupAlert(alert: ClickHouseBackupAlert): OperatorAlert {
  const headline =
    alert.kind === 'history-unreadable'
      ? 'Cannot tell whether ClickHouse is being backed up'
      : alert.kind === 'backup-failed'
        ? 'The ClickHouse backup failed'
        : 'The ClickHouse backup could not be started'

  return { severity: 'critical', kind: alert.kind, headline, detail: trim(alert.why) }
}

export function quotaAlert(event: QuotaBlockEvent): OperatorAlert | null {
  if (event.kind !== 'blocked') {
    return null
  }
  return {
    severity: 'warning',
    kind: 'quota-blocked',
    headline: 'An environment was blocked for the day',
    detail: trim(`${event.environmentId} sent ${event.events} against a quota of ${event.quota}`),
  }
}

export function spoolAlert(event: SpoolResendEvent): OperatorAlert | null {
  if (event.kind === 'resent') {
    return null
  }
  if (event.kind === 'quarantined') {
    return {
      severity: 'warning',
      kind: 'spool-quarantined',
      headline: 'A spooled batch was quarantined',
      detail: trim(`${event.key}: ${event.why}`),
    }
  }
  return {
    severity: 'critical',
    kind: `spool-${event.kind}`,
    headline:
      event.kind === 'undeleted'
        ? 'A spooled batch was replayed but not deleted'
        : 'A spooled batch could not be replayed',
    detail: trim(
      `${event.key}: ${event.error instanceof Error ? event.error.message : String(event.error)}`,
    ),
  }
}

export function operatorBody(alert: OperatorAlert, environment: string): string {
  const where = environment === '' ? '' : ` [${environment}]`
  return JSON.stringify({
    content: `**${alert.severity.toUpperCase()}**${where} ${alert.headline}\n${alert.detail}`,
  })
}

export function operatorNotifier(
  channel: OperatorChannel,
): (alert: OperatorAlert) => Promise<void> {
  return async (alert) => {
    channel.onWrite?.(alert)

    const url = channel.webhookUrl
    const send = channel.fetch

    if (url === undefined || url === '' || send === undefined) {
      channel.onUndelivered?.(alert, 'no operator webhook is configured')
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), channel.timeoutMs ?? OPERATOR_TIMEOUT_MS)

    try {
      assertWebhookTarget(url)

      const response = await send(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: operatorBody(alert, channel.environment ?? ''),
        redirect: 'manual',
        signal: controller.signal,
      })

      if (!response.ok) {
        channel.onUndelivered?.(alert, `the endpoint answered ${response.status}`)
      }
    } catch (error) {
      channel.onUndelivered?.(alert, trim(error instanceof Error ? error.message : String(error)))
    } finally {
      clearTimeout(timer)
    }
  }
}
