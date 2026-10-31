export type ClickHouseConfig = {
  url: string
  database: string
  user: string
  password: string
  accessClientId?: string
  accessClientSecret?: string
}

export class ClickHouseError extends Error {
  readonly status: number
  readonly sql: string

  constructor(status: number, body: string, sql: string) {
    super(`ClickHouse returned HTTP ${status}: ${summarise(body)}`)
    this.name = 'ClickHouseError'
    this.status = status
    this.sql = sql
  }
}

function summarise(body: string): string {
  const exception = body.match(/Code:\s*\d+\.\s*DB::Exception:\s*([^\n]+)/)
  if (exception?.[1]) {
    return exception[1].trim()
  }
  const firstLine = body.trim().split('\n')[0] ?? ''
  return firstLine.length > 300 ? `${firstLine.slice(0, 300)}…` : firstLine
}

function headers(config: ClickHouseConfig): Record<string, string> {
  const result: Record<string, string> = {
    'X-ClickHouse-User': config.user,
    'X-ClickHouse-Key': config.password,
    'Content-Type': 'text/plain; charset=utf-8',
  }
  if (config.accessClientId && config.accessClientSecret) {
    result['CF-Access-Client-Id'] = config.accessClientId
    result['CF-Access-Client-Secret'] = config.accessClientSecret
  }
  return result
}

export type ExecuteOptions = {
  database?: string | null
  settings?: Record<string, string>
  fetch?: typeof fetch
}

export async function execute(
  config: ClickHouseConfig,
  sql: string,
  options: ExecuteOptions = {},
): Promise<string> {
  const target = options.database === undefined ? config.database : options.database
  const url = new URL(config.url)
  if (target) {
    url.searchParams.set('database', target)
  }
  for (const [name, value] of Object.entries(options.settings ?? {})) {
    url.searchParams.set(name, value)
  }

  const send = options.fetch ?? fetch
  const response = await send(url, { method: 'POST', headers: headers(config), body: sql })
  const body = await response.text()

  if (!response.ok) {
    throw new ClickHouseError(response.status, body, sql)
  }
  return body
}

export async function queryRows<T>(
  config: ClickHouseConfig,
  sql: string,
  options: ExecuteOptions = {},
): Promise<T[]> {
  const body = await execute(
    config,
    `${sql.trimEnd().replace(/;$/, '')} FORMAT JSONEachRow`,
    options,
  )
  return body
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as T)
}

export async function databaseExists(config: ClickHouseConfig): Promise<boolean> {
  const rows = await queryRows<{ name: string }>(
    config,
    `SELECT name FROM system.databases WHERE name = '${config.database.replace(/'/g, "''")}'`,
    { database: null },
  )
  return rows.length > 0
}

export async function ping(config: ClickHouseConfig): Promise<boolean> {
  try {
    await execute(config, 'SELECT 1', { database: null })
    return true
  } catch {
    return false
  }
}
