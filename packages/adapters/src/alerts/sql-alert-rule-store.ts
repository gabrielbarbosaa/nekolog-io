import {
  type AlertRule,
  type AlertRuleStore,
  type AlertState,
  type AlertTransition,
  parseAlertCondition,
} from '../alert-rule.ts'
import { crockfordId } from '../ids.ts'
import type { SqlRunner } from '../issues/sql-issue-store.ts'

const LIVE = `
select
  id, project_id, environment_id, name, condition, state,
  extract(epoch from state_changed_at) * 1000 as state_changed_ms,
  extract(epoch from last_notified_at) * 1000 as last_notified_ms
from alert_rules
where disabled_at is null
order by environment_id, created_at
limit $1
`

const APPLY = `
with asked as (
  select
    unnest($1::text[]) as id,
    unnest($2::text[]) as state,
    unnest($3::timestamptz[]) as at,
    unnest($4::double precision[]) as measured,
    unnest($5::text[]) as event_id
),
moved as (
  update alert_rules as rules
  set
    state = asked.state::alert_state,
    state_changed_at = asked.at,
    last_measured = asked.measured
  from asked
  where rules.id = asked.id
    and rules.disabled_at is null
    and rules.state <> asked.state::alert_state
  returning
    rules.id, rules.project_id, rules.environment_id,
    asked.event_id, asked.state, asked.at, asked.measured,
    (rules.condition ->> 'value')::double precision as threshold
),
recorded as (
  insert into alert_events (
    id, rule_id, project_id, environment_id, state, measured, threshold, at
  )
  select
    moved.event_id, moved.id, moved.project_id, moved.environment_id,
    moved.state::alert_state, moved.measured, moved.threshold, moved.at
  from moved
  on conflict (rule_id, at) do nothing
  returning id
)
select moved.id from moved
`

const ISSUE_ACTIVITY = `
select
  count(*) filter (
    where issues.first_seen_at >= $2::timestamptz and issues.first_seen_at < $3::timestamptz
  )::int as opened,
  count(*) filter (
    where issues.regressed_at >= $2::timestamptz and issues.regressed_at < $3::timestamptz
  )::int as regressed
from issues
join issue_environments on issue_environments.issue_id = issues.id
where issue_environments.environment_id = $1
`

export const ALERT_EVENT_ID_PREFIX = 'ale_'

export function newAlertEventId(): string {
  return crockfordId(ALERT_EVENT_ID_PREFIX, 'an event id')
}

function moment(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Refusing to stamp an alert at ${String(value)}`)
  }
  return new Date(value).toISOString()
}

function textFrom(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`An alert rule carried ${JSON.stringify(value)} as its ${field}`)
  }
  return value
}

function momentFrom(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }
  const asNumber = typeof value === 'string' ? Number(value) : value
  if (typeof asNumber !== 'number' || !Number.isFinite(asNumber)) {
    throw new Error(`An alert rule carried ${JSON.stringify(value)} where a moment belongs`)
  }
  return asNumber
}

function countFrom(value: unknown, field: string): number {
  const asNumber = typeof value === 'string' ? Number(value) : value
  if (typeof asNumber !== 'number' || !Number.isFinite(asNumber) || asNumber < 0) {
    throw new Error(`Issue activity answered ${JSON.stringify(value)} for ${field}`)
  }
  return asNumber
}

export function sqlAlertRuleStore(run: SqlRunner): AlertRuleStore {
  return {
    async live(limit: number): Promise<ReadonlyArray<AlertRule>> {
      if (limit <= 0) {
        return []
      }

      const rows = await run(LIVE, [limit])

      return rows.map((row) => ({
        id: textFrom(row.id, 'id'),
        projectId: textFrom(row.project_id, 'project id'),
        environmentId: textFrom(row.environment_id, 'environment id'),
        name: textFrom(row.name, 'name'),
        condition: parseAlertCondition(
          typeof row.condition === 'string' ? JSON.parse(row.condition) : row.condition,
        ),
        state: textFrom(row.state, 'state') as AlertState,
        stateChangedAt: momentFrom(row.state_changed_ms),
        lastNotifiedAt: momentFrom(row.last_notified_ms),
      }))
    },

    async applyTransitions(transitions: ReadonlyArray<AlertTransition>): Promise<number> {
      if (transitions.length === 0) {
        return 0
      }

      const rows = await run(APPLY, [
        transitions.map((one) => one.ruleId),
        transitions.map((one) => one.to),
        transitions.map((one) => moment(one.at)),
        transitions.map((one) => one.measured),
        transitions.map(() => newAlertEventId()),
      ])

      return rows.length
    },
  }
}

export function sqlIssueActivity(run: SqlRunner): (
  environmentId: string,
  window: { from: number; to: number },
) => Promise<{
  opened: number
  regressed: number
}> {
  return async (environmentId, window) => {
    const rows = await run(ISSUE_ACTIVITY, [environmentId, moment(window.from), moment(window.to)])
    const row = rows[0]
    if (row === undefined) {
      throw new Error('Postgres answered the issue activity query with no row at all')
    }
    return {
      opened: countFrom(row.opened, 'opened'),
      regressed: countFrom(row.regressed, 'regressed'),
    }
  }
}
