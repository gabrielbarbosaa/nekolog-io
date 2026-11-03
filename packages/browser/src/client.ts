import type { Logger } from '@nekolog-io/core'
import { configureSession, resetSession, sessionId, setUser } from './context.ts'
import { installFlushOnHide } from './flush.ts'
import { installGlobalHandlers } from './handlers.ts'
import { type BrowserLoggerOptions, createLogger } from './logger.ts'
import type { SessionOptions } from './session.ts'

export type InitOptions = BrowserLoggerOptions & {
  globalHandlers?: boolean
  flushOnHide?: boolean
  session?: SessionOptions
}

export type BrowserClient = {
  readonly logger: Logger
  setUser(id: string | null | undefined): void
  sessionId(): string
  resetSession(): string
  flush(): Promise<void>
  close(): Promise<void>
}

export function init(options: InitOptions = {}): BrowserClient {
  const { globalHandlers, flushOnHide, session, ...loggerOptions } = options

  if (session !== undefined) {
    configureSession(session)
  }

  const logger = createLogger(loggerOptions)
  const installed: Array<() => void> = []

  if (globalHandlers !== false) {
    installed.push(installGlobalHandlers(logger))
  }
  if (flushOnHide !== false) {
    installed.push(installFlushOnHide(logger))
  }

  return {
    get logger() {
      return logger
    },
    setUser,
    sessionId,
    resetSession,
    flush: () => logger.flush(),
    async close() {
      for (const uninstall of installed.splice(0)) {
        uninstall()
      }
      await logger.flush()
    },
  }
}
