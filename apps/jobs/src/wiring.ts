import type { BlobStore, KvNamespace } from '@nekolog-io/adapters'
import { kvQuotaStore } from '@nekolog-io/adapters'
import { type ClickHouseConfig, queryRows } from '@nekolog-io/clickhouse/client'
import { clickHouseLogStore } from '@nekolog-io/clickhouse/log-store'
import { clickHouseUsageStore } from '@nekolog-io/clickhouse/usage-store'
import { capacityAlert, type OperatorAlert, quotaAlert, spoolAlert } from './alerts/operator.ts'
import type { RunSummary } from './run.ts'
import type { CapacityAlert, DiskReading } from './tasks/capacity-watch.ts'
import type { QuotaBlockEvent } from './tasks/quota-block.ts'
import type { SpoolResendEvent } from './tasks/spool-resend.ts'
import type { TaskDeps } from './tasks.ts'

export function write(level: 'log' | 'warn', ...args: unknown[]): void {
  const target = (
    globalThis as unknown as {
      console?: Record<string, ((...args: unknown[]) => void) | undefined>
    }
  ).console
  try {
    target?.[level]?.(...args)
  } catch {
    return
  }
}

export function writeSummary(summary: RunSummary): void {
  write('log', JSON.stringify({ app: 'nekolog/jobs', ...summary }))
}

export function writeSpoolEvent(event: SpoolResendEvent): void {
  if (event.kind === 'resent') {
    return
  }
  write('warn', '[nekolog/jobs] spool', JSON.stringify({ kind: event.kind, key: event.key }))
}

export function writeQuotaEvent(event: QuotaBlockEvent): void {
  write(
    'warn',
    '[nekolog/jobs] quota',
    JSON.stringify({
      kind: event.kind,
      environmentId: event.environmentId,
      events: event.events,
      quota: event.quota,
    }),
  )
}

export function writeCapacityAlert(alert: CapacityAlert): void {
  write('warn', '[nekolog/jobs] capacity', JSON.stringify(alert))
}

export function diskReaderFor(
  config: ClickHouseConfig,
): (signal: AbortSignal) => Promise<DiskReading[]> {
  return async (signal: AbortSignal): Promise<DiskReading[]> => {
    const rows = await queryRows<{ name: string; free_space: string; total_space: string }>(
      config,
      'select name, free_space, total_space from system.disks',
      { fetch: (input, init) => fetch(input, { ...init, signal }) },
    )
    return rows.map((row) => ({
      name: row.name,
      freeBytes: Number(row.free_space),
      totalBytes: Number(row.total_space),
    }))
  }
}

export function raise(
  tell: (alert: OperatorAlert) => Promise<void>,
  alert: OperatorAlert | null,
): void {
  if (alert === null) {
    return
  }
  void tell(alert)
}

export type CoreWiring = {
  spool: BlobStore
  kv: KvNamespace
  clickHouse: ClickHouseConfig
  dailyQuota?: number
  tellOperator: (alert: OperatorAlert) => Promise<void>
}

export function coreTaskDeps(wiring: CoreWiring): TaskDeps {
  const tellOperator = wiring.tellOperator

  return {
    spool: wiring.spool,
    logStore: clickHouseLogStore(wiring.clickHouse),
    usage: clickHouseUsageStore(wiring.clickHouse),
    quotas: kvQuotaStore(wiring.kv),
    ...(wiring.dailyQuota === undefined ? {} : { dailyQuota: wiring.dailyQuota }),
    onSpoolEvent: (event) => {
      writeSpoolEvent(event)
      raise(tellOperator, spoolAlert(event))
    },
    onQuotaEvent: (event) => {
      writeQuotaEvent(event)
      raise(tellOperator, quotaAlert(event))
    },
    readDisks: diskReaderFor(wiring.clickHouse),
    onCapacityAlert: (alert) => {
      writeCapacityAlert(alert)
      raise(tellOperator, capacityAlert(alert))
    },
  }
}

export function assertNoFailures(summary: RunSummary): RunSummary {
  if (summary.failed === 0) {
    return summary
  }
  const broken = summary.ran
    .filter((outcome) => outcome.status !== 'ok')
    .map((outcome) => `${outcome.name} (${outcome.status})`)
    .join(', ')
  throw new Error(`Scheduled tasks did not finish: ${broken}`)
}
