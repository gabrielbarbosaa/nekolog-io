import type {
  AlertChannel,
  AlertChannelKind,
  AlertChannelStore,
  AlertNoticeStore,
  NoticeOutcome,
  PendingAlert,
} from '../alert-channel.ts'
import {
  type AlertState,
  type AlertWindow,
  cooldownMinutes,
  parseAlertCondition,
} from '../alert-rule.ts'
import type { SqlRunner } from '../issues/sql-issue-store.ts'

const BY_IDS = `
select id, project_id, name, kind, target, sealed_secret, locale
from alert_channels
where project_id = $1 and disabled_at is null and id = any($2::text[])
order by name
`

const AWAITING_NOTICE = `
select
  alert_rules.id as id,
  alert_rules.project_id as project_id,
  alert_rules.environment_id as environment_id,
  environments.name as environment_name,
  alert_rules.name as name,
  alert_rules.state as state,
  alert_rules.condition as condition,
  alert_rules.last_measured as last_measured,
  extract(epoch from alert_rules.state_changed_at) * 1000 as changed_ms,
  extract(epoch from (
    select max(fired.at) from alert_events as fired
    where fired.rule_id = alert_rules.id
      and fired.state = 'firing'
      and fired.notified_at is not null
  )) * 1000 as last_firing_notice_ms
from alert_rules
join environments on environments.id = alert_rules.environment_id
where alert_rules.disabled_at is null
  and alert_rules.state_changed_at is not null
  and (
    alert_rules.last_notified_at is null
    or alert_rules.last_notified_at < alert_rules.state_changed_at
  )
order by alert_rules.state_changed_at
limit $1
`

const MARK_NOTIFIED = `
update alert_rules
set last_notified_at = $2::timestamptz
where id = $1 and state_changed_at = $3::timestamptz
`

const RECORD_EVENT = `
update alert_events
set notified_at = $3::timestamptz, channels_sent = $4, suppressed = $5::alert_suppression
where rule_id = $1 and at = $2::timestamptz
`

const PRUNE = `
delete from alert_events
where id in (
  select id from alert_events where at < $1::timestamptz order by at limit $2
)
returning id
`

function moment(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Refusing to stamp an alert notice at ${String(value)}`)
  }
  return new Date(value).toISOString()
}

function textFrom(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`An alert channel carried ${JSON.stringify(value)} as its ${field}`)
  }
  return value
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }
  const asNumber = typeof value === 'string' ? Number(value) : value
  if (typeof asNumber !== 'number' || !Number.isFinite(asNumber)) {
    throw new Error(`An alert rule carried ${JSON.stringify(value)} where a number belongs`)
  }
  return asNumber
}

export function sqlAlertChannelStore(run: SqlRunner): AlertChannelStore {
  return {
    async byIds(projectId: string, ids: readonly string[]): Promise<ReadonlyArray<AlertChannel>> {
      if (ids.length === 0) {
        return []
      }

      const rows = await run(BY_IDS, [projectId, [...ids]])

      return rows.map((row) => ({
        id: textFrom(row.id, 'id'),
        projectId: textFrom(row.project_id, 'project id'),
        name: textFrom(row.name, 'name'),
        kind: textFrom(row.kind, 'kind') as AlertChannelKind,
        target: textFrom(row.target, 'target'),
        sealedSecret: row.sealed_secret === null ? null : textFrom(row.sealed_secret, 'secret'),
        locale: textFrom(row.locale, 'locale'),
      }))
    },
  }
}

export function sqlAlertNoticeStore(run: SqlRunner): AlertNoticeStore {
  return {
    async awaitingNotice(limit: number): Promise<ReadonlyArray<PendingAlert>> {
      if (limit <= 0) {
        return []
      }

      const rows = await run(AWAITING_NOTICE, [limit])

      return rows.map((row) => {
        const condition = parseAlertCondition(
          typeof row.condition === 'string' ? JSON.parse(row.condition) : row.condition,
        )

        return {
          ruleId: textFrom(row.id, 'id'),
          projectId: textFrom(row.project_id, 'project id'),
          environmentId: textFrom(row.environment_id, 'environment id'),
          environmentName: textFrom(row.environment_name, 'environment name'),
          ruleName: textFrom(row.name, 'name'),
          state: textFrom(row.state, 'state') as AlertState,
          measured: numberOrNull(row.last_measured) ?? 0,
          threshold: condition.value ?? null,
          window: condition.window as AlertWindow,
          query: condition.query,
          type: condition.type,
          channels: condition.channels,
          changedAt: numberOrNull(row.changed_ms) ?? 0,
          cooldownMinutes: cooldownMinutes(condition.cooldown),
          lastFiringNoticeAt: numberOrNull(row.last_firing_notice_ms),
        }
      })
    },

    async markNotified(ruleId: string, at: number, forChangeAt: number): Promise<void> {
      await run(MARK_NOTIFIED, [ruleId, moment(at), moment(forChangeAt)])
    },

    async recordOutcome(ruleId: string, changedAt: number, outcome: NoticeOutcome): Promise<void> {
      await run(RECORD_EVENT, [
        ruleId,
        moment(changedAt),
        outcome.notifiedAt === null ? null : moment(outcome.notifiedAt),
        outcome.channelsSent,
        outcome.suppressed,
      ])
    },

    async prune(before: number, limit: number): Promise<number> {
      if (limit <= 0) {
        return 0
      }
      const rows = await run(PRUNE, [moment(before), limit])
      return rows.length
    },
  }
}
