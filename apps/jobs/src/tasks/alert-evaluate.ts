import {
  type AlertRule,
  type AlertRuleStore,
  type AlertState,
  type AlertTransition,
  compare,
  windowMinutes,
} from '@nekolog-io/adapters'
import {
  type AlertScope,
  type AlertTarget,
  alertBatchQuery,
  type Measurement,
  measurableHere,
  measurementsFrom,
} from '@nekolog-io/clickhouse/alerts'
import type { Task, TaskContext } from '../task.ts'

export const ALERT_EVALUATE_TASK = 'alert-evaluate'

export const MAX_RULES_PER_RUN = 200
export const MAX_ENVIRONMENTS_PER_RUN = 20

export type IssueActivity = {
  opened: number
  regressed: number
}

export type IssueActivitySource = (
  environmentId: string,
  window: { from: number; to: number },
) => Promise<IssueActivity>

export type AlertMeasurer = (
  sql: string,
  params: Record<string, string>,
) => Promise<ReadonlyArray<Record<string, unknown>>>

export type AlertEvaluateEvent =
  | { kind: 'transition'; ruleId: string; to: AlertState; measured: number }
  | { kind: 'environment_failed'; environmentId: string; why: string }

export type AlertEvaluateReport = {
  rules: number
  environments: number
  measured: number
  fired: number
  resolved: number
  skipped: number
  stopped: 'finished' | 'store_unavailable' | 'out_of_time'
}

export type AlertEvaluateOptions = {
  rules: AlertRuleStore
  measure: AlertMeasurer
  target: AlertTarget
  issueActivity?: IssueActivitySource
  perRun?: number
  now?: () => number
  onEvent?: (event: AlertEvaluateEvent) => void
}

export function measuredValue(rule: AlertRule, measurement: Measurement): number {
  if (rule.condition.type === 'error_rate') {
    return measurement.matched === 0 ? 0 : (measurement.errors / measurement.matched) * 100
  }
  return measurement.matched
}

export function shouldFire(rule: AlertRule, measured: number, measurement: Measurement): boolean {
  const { type, operator, value, minEvents } = rule.condition

  if (type === 'absence') {
    return measured === 0
  }
  if (type === 'error_rate') {
    if (measurement.matched < (minEvents ?? 0)) {
      return false
    }
  }
  if (operator === undefined || value === undefined) {
    return false
  }
  return compare(measured, operator, value)
}

export function groupByEnvironment(
  rules: ReadonlyArray<AlertRule>,
): ReadonlyArray<[AlertScope, AlertRule[]]> {
  const groups = new Map<string, { scope: AlertScope; rules: AlertRule[] }>()

  for (const rule of rules) {
    const key = `${rule.projectId}\u0000${rule.environmentId}`
    const found = groups.get(key)
    if (found === undefined) {
      groups.set(key, {
        scope: { projectId: rule.projectId, environmentId: rule.environmentId },
        rules: [rule],
      })
    } else {
      found.rules.push(rule)
    }
  }

  return [...groups.values()].map((group) => [group.scope, group.rules])
}

function describe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300)
}

export function alertEvaluateTask(options: AlertEvaluateOptions): Task {
  const perRun = options.perRun ?? MAX_RULES_PER_RUN
  const now = options.now ?? Date.now

  return {
    name: ALERT_EVALUATE_TASK,
    everyMinutes: 1,

    async run(context: TaskContext): Promise<AlertEvaluateReport> {
      const report: AlertEvaluateReport = {
        rules: 0,
        environments: 0,
        measured: 0,
        fired: 0,
        resolved: 0,
        skipped: 0,
        stopped: 'finished',
      }

      let live: ReadonlyArray<AlertRule>
      try {
        live = await options.rules.live(perRun)
      } catch {
        report.stopped = 'store_unavailable'
        return report
      }

      report.rules = live.length
      if (live.length === 0) {
        return report
      }

      const at = new Date(context.scheduledAt)
      const transitions: AlertTransition[] = []
      const groups = groupByEnvironment(live)
      report.environments = groups.length

      for (const [scope, rules] of groups.slice(0, MAX_ENVIRONMENTS_PER_RUN)) {
        if (context.signal.aborted) {
          report.stopped = 'out_of_time'
          break
        }

        const measurable = rules.filter(measurableHere)
        const byId = new Map<string, Measurement>()

        if (measurable.length > 0) {
          try {
            const batch = alertBatchQuery(measurable, scope, at, options.target)
            const rows = await options.measure(batch.sql, batch.params)
            for (const measurement of measurementsFrom(batch, rows[0])) {
              byId.set(measurement.ruleId, measurement)
            }
            report.measured += measurable.length
          } catch (error) {
            report.skipped += rules.length
            options.onEvent?.({
              kind: 'environment_failed',
              environmentId: scope.environmentId,
              why: describe(error),
            })
            continue
          }
        }

        for (const rule of rules) {
          const measurement = byId.get(rule.id)
          let measured: number

          if (measurement !== undefined) {
            measured = measuredValue(rule, measurement)
          } else if (options.issueActivity !== undefined) {
            const from = at.getTime() - windowMinutes(rule.condition.window) * 60_000
            let activity: IssueActivity
            try {
              activity = await options.issueActivity(rule.environmentId, {
                from,
                to: at.getTime(),
              })
            } catch (error) {
              report.skipped += 1
              options.onEvent?.({
                kind: 'environment_failed',
                environmentId: scope.environmentId,
                why: describe(error),
              })
              continue
            }
            measured =
              rule.condition.type === 'issue_regression' ? activity.regressed : activity.opened
          } else {
            report.skipped += 1
            continue
          }

          const firing =
            measurement === undefined ? measured > 0 : shouldFire(rule, measured, measurement)
          const next: AlertState = firing ? 'firing' : 'ok'

          if (next === rule.state) {
            continue
          }

          transitions.push({ ruleId: rule.id, to: next, measured, at: now() })
          if (next === 'firing') {
            report.fired += 1
          } else {
            report.resolved += 1
          }
          options.onEvent?.({ kind: 'transition', ruleId: rule.id, to: next, measured })
        }
      }

      if (transitions.length > 0) {
        try {
          await options.rules.applyTransitions(transitions)
        } catch {
          report.stopped = 'store_unavailable'
        }
      }

      return report
    },
  }
}
