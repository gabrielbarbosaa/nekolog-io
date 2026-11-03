import { createLogger as createCoreLogger, type Logger, type LoggerOptions } from '@nekolog-io/core'
import {
  createLogger as createNodeLogger,
  installProcessHooks,
  type NodeLoggerOptions,
} from '@nekolog-io/node'
import { attributesFor, type ErrorContext, type ErrorRequest } from './request.ts'
import { nextRuntime } from './runtime.ts'
import { SDK_NAME, SDK_VERSION } from './version.ts'

export type RegisterOptions = NodeLoggerOptions & {
  processHooks?: boolean
}

let server: Logger | undefined
let uninstall: (() => void) | undefined

export function serverLogger(): Logger | undefined {
  return server
}

export function register(options: RegisterOptions = {}): Logger {
  if (server !== undefined) {
    return server
  }

  const { processHooks, ...rest } = options
  const sdk = { name: SDK_NAME, version: SDK_VERSION }

  if (nextRuntime() === 'edge') {
    server = createCoreLogger({ ...(rest as LoggerOptions), runtime: 'edge', sdk })
    return server
  }

  server = createNodeLogger({ ...rest, sdk })
  if (processHooks !== false) {
    uninstall = installProcessHooks(server)
  }
  return server
}

export async function unregister(): Promise<void> {
  const logger = server
  const stop = uninstall
  server = undefined
  uninstall = undefined
  stop?.()
  await logger?.flush()
}

export type RequestErrorHandler = (
  error: unknown,
  request?: ErrorRequest,
  context?: ErrorContext,
) => void

export function createOnRequestError(logger: () => Logger | undefined): RequestErrorHandler {
  return (error, request, context) => {
    const target = logger()
    if (target === undefined) {
      return
    }
    try {
      target.error(error, attributesFor(request, context))
    } catch {
      return
    }
  }
}

export const onRequestError: RequestErrorHandler = createOnRequestError(serverLogger)
