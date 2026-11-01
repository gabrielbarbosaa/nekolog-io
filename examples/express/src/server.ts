import { installProcessHooks } from '@nekolog-io/node'
import { createApp } from './app.ts'
import { createExampleLogger } from './logger.ts'

const DEFAULT_PORT = 3100

function portFrom(value: string | undefined): number {
  if (value === undefined || value === '') {
    return DEFAULT_PORT
  }
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`PORT precisa ser uma porta válida, veio ${JSON.stringify(value)}`)
  }
  return port
}

const logger = createExampleLogger({
  onError: (error) => {
    process.stderr.write(`[nekolog] ${error instanceof Error ? error.message : String(error)}\n`)
  },
})

installProcessHooks(logger)

const server = createApp({ logger }).listen(portFrom(process.env.PORT), () => {
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : DEFAULT_PORT
  process.stdout.write(`example-express em http://127.0.0.1:${port}\n`)
})
