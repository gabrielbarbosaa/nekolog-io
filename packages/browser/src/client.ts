import type { Logger } from '@nekolog-io/core'
import type { BreadcrumbData } from './breadcrumbs.ts'
import { configureSession, resetSession, sessionId, setUser } from './context.ts'
import { installFlushOnHide } from './flush.ts'
import { installGlobalHandlers } from './handlers.ts'
import { type BrowserLoggerOptions, createLogger } from './logger.ts'
import type { SessionOptions } from './session.ts'
import {
  addBreadcrumb,
  clearBreadcrumbs,
  configureBreadcrumbs,
  type InstallBreadcrumbOptions,
  installBreadcrumbs,
} from './trail.ts'

export type InitOptions = BrowserLoggerOptions & {
  globalHandlers?: boolean
  flushOnHide?: boolean
  session?: SessionOptions
  breadcrumbOptions?: InstallBreadcrumbOptions
}

export type BrowserClient = {
  readonly logger: Logger
  setUser(id: string | null | undefined): void
  sessionId(): string
  resetSession(): string
  addBreadcrumb(message: string, data?: BreadcrumbData): void
  clearBreadcrumbs(): void
  flush(): Promise<void>
  close(): Promise<void>
}

export function init(options: InitOptions = {}): BrowserClient {
  const { globalHandlers, flushOnHide, session, breadcrumbOptions, ...loggerOptions } = options

  if (session !== undefined) {
    configureSession(session)
  }
  if (options.breadcrumbs !== undefined) {
    configureBreadcrumbs(options.breadcrumbs)
  }

  const logger = createLogger(loggerOptions)
  const installed: Array<() => void> = []

  if (globalHandlers !== false) {
    installed.push(installGlobalHandlers(logger))
  }
  if (flushOnHide !== false) {
    installed.push(installFlushOnHide(logger))
  }

  installed.push(
    installBreadcrumbs({
      ...options.breadcrumbs,
      page: options.page,
      endpoint: options.transport?.endpoint,
      ...breadcrumbOptions,
    }),
  )

  return {
    get logger() {
      return logger
    },
    setUser,
    sessionId,
    resetSession,
    addBreadcrumb: (message, data) => addBreadcrumb(message, data),
    clearBreadcrumbs,
    flush: () => logger.flush(),
    async close() {
      for (const uninstall of installed.splice(0)) {
        uninstall()
      }
      await logger.flush()
    },
  }
}
