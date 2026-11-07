import { expect } from '@playwright/test'
import {
  CLICKHOUSE_DB,
  CLICKHOUSE_INSERT_PASSWORD,
  CLICKHOUSE_INSERT_USER,
  CLICKHOUSE_READ_PASSWORD,
  CLICKHOUSE_READ_USER,
  CLICKHOUSE_URL,
} from '../../playwright.config'
import { anAccount, api, openBrowser, signIn } from './world'

export type Line = {
  timestamp: string
  level: string
  message: string
  service: string
  attributes?: Record<string, string>
  source?: string
  traceId?: string
  spanId?: string
}

function stamp(value: Date): string {
  return value.toISOString().replace('T', ' ').replace('Z', '')
}

async function run(sql: string, user: string, password: string): Promise<string> {
  const response = await fetch(`${CLICKHOUSE_URL}/?database=${CLICKHOUSE_DB}`, {
    method: 'POST',
    headers: { 'X-ClickHouse-User': user, 'X-ClickHouse-Key': password },
    body: sql,
  })
  const body = await response.text()
  if (!response.ok) {
    throw new Error(`ClickHouse answered ${response.status}: ${body.slice(0, 300)}`)
  }
  return body
}

export async function clickHouseAnswers(): Promise<boolean> {
  try {
    await run('SELECT 1', CLICKHOUSE_READ_USER, CLICKHOUSE_READ_PASSWORD)
    return true
  } catch {
    return false
  }
}

export const RETENTION_DAYS = 30

export async function writeLines(
  projectId: string,
  environmentId: string,
  lines: readonly Line[],
): Promise<void> {
  const rows = lines
    .map((line) =>
      JSON.stringify({
        project_id: projectId,
        environment_id: environmentId,
        timestamp: line.timestamp,
        received_at: line.timestamp,
        level: line.level,
        message: line.message,
        service: line.service,
        source: line.source ?? 'node',
        trace_id: line.traceId ?? '',
        span_id: line.spanId ?? '',
        attributes: line.attributes ?? {},
        retention_days: RETENTION_DAYS,
      }),
    )
    .join('\n')

  await run(
    `INSERT INTO logs FORMAT JSONEachRow\n${rows}`,
    CLICKHOUSE_INSERT_USER,
    CLICKHOUSE_INSERT_PASSWORD,
  )

  const counted = await run(
    `SELECT count() AS n FROM logs WHERE project_id = '${projectId}' FORMAT JSONEachRow`,
    CLICKHOUSE_READ_USER,
    CLICKHOUSE_READ_PASSWORD,
  )
  const written = Number((JSON.parse(counted.trim() || '{"n":0}') as { n: string }).n)

  if (written < lines.length) {
    throw new Error(
      `ClickHouse accepted ${lines.length} lines and kept ${written}. The table expires by ` +
        '`timestamp + retention_days`, so a row with no retention_days is dropped at the insert ' +
        'and the insert still answers 200.',
    )
  }
}

export const LINES_START_AGO_MS = 30 * 60 * 1000

export async function aProjectWithLines(context: Parameters<typeof openBrowser>[0], howMany = 120) {
  const page = await openBrowser(context)
  const email = await anAccount(page)
  expect((await signIn(page, email)).status).toBe(200)

  const org = String(
    (await api(page, '/api/orgs', { name: `Acme ${Date.now()}` })).body?.organization,
  )
  const project = String(
    (await api(page, `/api/orgs/${org}/projects`, { name: 'The Shop' })).body?.project,
  )
  const read = await api(page, `/api/orgs/${org}/projects/${project}`)
  const environments = (read.body?.environments ?? []) as Array<{ id: string; name: string }>

  const production = environments.find((one) => one.name === 'production') ?? environments[0]
  if (production === undefined) {
    throw new Error('the project was born with no environment')
  }

  await writeLines(
    project,
    production.id,
    aMinuteOfLines(new Date(Date.now() - LINES_START_AGO_MS), howMany),
  )

  return { page, org, project, environment: production.id, environments }
}

export function aMinuteOfLines(start: Date, count: number): Line[] {
  const levels = ['info', 'warn', 'error', 'debug']

  return Array.from({ length: count }, (_, at) => ({
    timestamp: stamp(new Date(start.getTime() + at * 1000)),
    level: levels[at % levels.length] as string,
    message: `line number ${at} <script>alert(1)</script>`,
    service: at % 3 === 0 ? 'checkout' : 'api',
    attributes: { orderId: `ord_${at}`, attempt: String(at % 5) },
  }))
}
