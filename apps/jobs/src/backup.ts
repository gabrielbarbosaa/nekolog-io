import { operatorNotifier } from './alerts/operator.ts'
import { backupDaemonConfigFrom, NOTHING_TO_DO, runBackupCycle } from './backup/daemon.ts'
import { write } from './wiring.ts'

function report(line: string): void {
  process.stdout.write(`${line}\n`)
}

async function main(): Promise<void> {
  const config = backupDaemonConfigFrom(process.env)

  if (config === undefined) {
    write('warn', NOTHING_TO_DO)
    await new Promise(() => undefined)
    return
  }

  const tellOperator = operatorNotifier({
    ...(process.env.OPS_DISCORD_WEBHOOK_URL
      ? { webhookUrl: process.env.OPS_DISCORD_WEBHOOK_URL }
      : {}),
    fetch: globalThis.fetch as never,
    environment: config.environment,
    onWrite: (alert) =>
      write('warn', '[nekolog/backup]', JSON.stringify({ kind: alert.kind, detail: alert.detail })),
    onUndelivered: (alert, why) =>
      write('warn', '[nekolog/backup] operator', JSON.stringify({ kind: alert.kind, why })),
  })

  report(
    `backing ${config.environment} up daily to ${config.destination.bucketUrl}, ` +
      `checked every ${config.checkMinutes} min`,
  )

  let stopped = false
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      stopped = true
      process.exit(0)
    })
  }

  while (!stopped) {
    await runBackupCycle({
      config,
      tellOperator,
      onReport: (one) => write('log', '[nekolog/backup]', JSON.stringify(one)),
    })
    await new Promise((resolve) => setTimeout(resolve, config.checkMinutes * 60_000))
  }
}

try {
  await main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
