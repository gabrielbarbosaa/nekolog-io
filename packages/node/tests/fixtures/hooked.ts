import type { LogEvent, Sink } from '../../src/index.ts'
import { createLogger, installProcessHooks, runWithContext } from '../../src/index.ts'

const collected: LogEvent[] = []

const sink: Sink = {
  emit(event) {
    collected.push(event)
  },
  async flush() {
    await new Promise((resolve) => setTimeout(resolve, 80))
    const summary = collected.map((event) => [event.level, event.message, event.attributes])
    process.stdout.write(`FLUSHED ${JSON.stringify(summary)}\n`)
  },
}

const log = createLogger({ sink, level: 'trace' })
const mode = process.argv[2]

if (mode === 'graceful') {
  process.on('SIGTERM', () => {
    process.stdout.write('APP HANDLER RAN\n')
    setTimeout(() => process.exit(7), 200)
  })
}

if (mode !== 'bare') {
  installProcessHooks(log)
}

runWithContext({ attributes: { requestId: 'r-1' } }, () => {
  log.info('before the end')

  if (mode === 'uncaught' || mode === 'bare') {
    setTimeout(() => {
      throw new Error('kaboom')
    }, 10)
  }

  if (mode === 'rejection') {
    void Promise.reject(new Error('no catch here'))
  }

  if (mode === 'signal') {
    setTimeout(() => process.kill(process.pid, 'SIGTERM'), 10)
  }

  if (mode === 'emitted' || mode === 'graceful') {
    setTimeout(() => process.emit('SIGTERM'), 10)
  }
})
