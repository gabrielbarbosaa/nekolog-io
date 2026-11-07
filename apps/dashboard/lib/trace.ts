import { type Level, type LogRow, levelOf, momentOf, textOf } from './explorer'

export const TRACE_ID_CHARS = 32
export const TRACE_WINDOW_MS: number = 30 * 60 * 1000

const HEX_PATTERN = /^[0-9a-f]+$/

export type TraceStep = {
  key: string
  row: LogRow
  at: number
  offsetMs: number
  service: string
  source: string
  level: Level
  handover: boolean
}

export type Trace = {
  traceId: string
  steps: TraceStep[]
  startedAt: number
  elapsedMs: number
  services: string[]
  sources: string[]
  crossed: boolean
}

export function isTraceId(value: string): boolean {
  return value.length === TRACE_ID_CHARS && HEX_PATTERN.test(value)
}

export function traceIdOf(value: string): string {
  const lowered = value.toLowerCase()
  return isTraceId(lowered) ? lowered : ''
}

export function windowAround(anchor: Date): { from: Date; to: Date } {
  return {
    from: new Date(anchor.getTime() - TRACE_WINDOW_MS),
    to: new Date(anchor.getTime() + TRACE_WINDOW_MS),
  }
}

export function traceHrefOf(org: string, project: string, row: LogRow): string | undefined {
  const traceId = traceIdOf(textOf(row, 'trace_id'))
  if (traceId === '') {
    return undefined
  }
  const at = momentOf(row)
  const when = Number.isFinite(at) ? `?at=${encodeURIComponent(new Date(at).toISOString())}` : ''
  return `/${org}/${project}/traces/${traceId}${when}`
}

export function offsetLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return ''
  }
  if (ms < 1000) {
    return `+${Math.round(ms)}ms`
  }
  if (ms < 60_000) {
    return `+${(ms / 1000).toFixed(2)}s`
  }
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  return `+${minutes}m${String(seconds).padStart(2, '0')}s`
}

function unique(values: readonly string[]): string[] {
  const seen: string[] = []
  for (const value of values) {
    if (value !== '' && !seen.includes(value)) {
      seen.push(value)
    }
  }
  return seen
}

export function traceFrom(traceId: string, rows: readonly LogRow[]): Trace {
  const timed = rows
    .map((row) => ({ row, at: momentOf(row) }))
    .filter((one) => Number.isFinite(one.at))
    .sort((a, b) => a.at - b.at)

  const startedAt = timed[0]?.at ?? Number.NaN
  const steps: TraceStep[] = []
  let previous = ''

  for (const one of timed) {
    const service = textOf(one.row, 'service')
    steps.push({
      key: `${one.at}-${steps.length}`,
      row: one.row,
      at: one.at,
      offsetMs: one.at - startedAt,
      service,
      source: textOf(one.row, 'source'),
      level: levelOf(one.row),
      handover: steps.length > 0 && service !== previous,
    })
    previous = service
  }

  const last = steps[steps.length - 1]
  const sources = unique(steps.map((step) => step.source))

  return {
    traceId,
    steps,
    startedAt,
    elapsedMs: last === undefined ? 0 : last.offsetMs,
    services: unique(steps.map((step) => step.service)),
    sources,
    crossed: sources.length > 1,
  }
}
