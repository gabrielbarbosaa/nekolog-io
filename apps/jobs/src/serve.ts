import { serve } from '@hono/node-server'
import type { SqlRunner } from '@nekolog-io/adapters'
import { ping } from '@nekolog-io/clickhouse/client'
import postgres from 'postgres'
import { createJobsApp } from './app.ts'
import { sendHeartbeat } from './heartbeat.ts'
import type { RunSummary } from './run.ts'
import { startScheduler } from './scheduler.ts'
import { type SelfHostJobsConfig, selfHostJobsConfigFrom, selfHostJobTasks } from './self-host.ts'
import { write, writeSummary } from './wiring.ts'

function report(line: string): void {
  process.stdout.write(`${line}\n`)
}

function summaryWriter(config: SelfHostJobsConfig): (summary: RunSummary) => void {
  return (summary) => {
    writeSummary(summary)
    if (config.heartbeatUrl !== undefined) {
      void sendHeartbeat(summary, {
        url: config.heartbeatUrl,
        onProblem: (reason) => write('warn', '[nekolog/jobs] heartbeat', reason),
      })
    }
  }
}

async function main(): Promise<void> {
  const config = selfHostJobsConfigFrom(process.env)

  if (!(await ping(config.clickHouse))) {
    throw new Error(`Nothing answered on ClickHouse at ${config.clickHouse.url}.`)
  }

  const sql = postgres(config.databaseUrl, { max: 2, onnotice: () => {} })
  await sql`select 1`
  const run: SqlRunner = async (text, params) => sql.unsafe(text, params as never[])

  const tasks = selfHostJobTasks({ config, sql: run })
  const app = createJobsApp({
    taskCount: tasks.length,
    ...(config.version === undefined ? {} : { version: config.version }),
  })

  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host })
  const stopScheduler = startScheduler({
    tasks,
    onSummary: summaryWriter(config),
    onOverlap: (scheduledAt) =>
      write('warn', '[nekolog/jobs] overlap', JSON.stringify({ scheduledAt })),
  })

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      stopScheduler()
      server.close(() => {
        void sql.end({ timeout: 5 }).then(() => process.exit(0))
      })
    })
  }

  report(`jobs running, ${tasks.length} tasks, health on http://${config.host}:${config.port}`)
  report(`ClickHouse ${config.clickHouse.url} database ${config.clickHouse.database}`)
  report(`spool ${config.spoolDir}  kv ${config.kvDir}`)
}

try {
  await main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
