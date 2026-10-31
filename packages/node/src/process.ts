import type { Logger } from '@nekolog-io/core'

export const DEFAULT_FLUSH_TIMEOUT_MS = 2_000
export const DEFAULT_SIGNALS: readonly string[] = ['SIGTERM', 'SIGINT']

export type ProcessListener = (...args: unknown[]) => void

export type ProcessLike = {
  pid: number
  on(event: string, listener: ProcessListener): unknown
  removeListener(event: string, listener: ProcessListener): unknown
  listenerCount(event: string): number
  exit(code?: number): unknown
  kill(pid: number, signal?: string): unknown
}

export type ProcessHookOptions = {
  uncaughtException?: boolean
  unhandledRejection?: boolean
  beforeExit?: boolean
  signals?: readonly string[] | false
  flushTimeoutMs?: number
  exitOnFatal?: boolean
  onError?: (error: unknown) => void
  target?: ProcessLike
}

function globalProcess(): ProcessLike | undefined {
  return (globalThis as { process?: ProcessLike }).process
}

function writeToStderr(prefix: string, error: unknown): void {
  const target = (globalThis as { console?: { error?: (...args: unknown[]) => void } }).console
  try {
    target?.error?.(prefix, error)
  } catch {
    return
  }
}

function delay(milliseconds: number): { promise: Promise<void>; cancel: () => void } {
  const timers = globalThis as {
    setTimeout?: (fn: () => void, ms: number) => unknown
    clearTimeout?: (id: unknown) => void
  }
  let handle: unknown
  const promise = new Promise<void>((resolve) => {
    handle = timers.setTimeout?.(resolve, milliseconds)
    ;(handle as { unref?: () => void } | undefined)?.unref?.()
  })
  return { promise, cancel: () => timers.clearTimeout?.(handle) }
}

export function installProcessHooks(logger: Logger, options: ProcessHookOptions = {}): () => void {
  const target = options.target ?? globalProcess()
  if (!target) {
    return () => undefined
  }

  const report = options.onError ?? ((error: unknown) => writeToStderr('[nekolog]', error))
  const flushTimeoutMs = options.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS
  const exitOnFatal = options.exitOnFatal !== false
  const signals = options.signals === false ? [] : (options.signals ?? DEFAULT_SIGNALS)

  const installed: Array<[string, ProcessListener]> = []

  const listen = (event: string, listener: ProcessListener): void => {
    target.on(event, listener)
    installed.push([event, listener])
  }

  const uninstall = (): void => {
    while (installed.length > 0) {
      const entry = installed.pop()
      if (entry) {
        target.removeListener(entry[0], entry[1])
      }
    }
  }

  const flushQuietly = async (): Promise<void> => {
    const timer = delay(flushTimeoutMs)
    try {
      await Promise.race([logger.flush(), timer.promise])
    } catch (error) {
      report(error)
    } finally {
      timer.cancel()
    }
  }

  const someoneElseHandles = (event: string): boolean => target.listenerCount(event) > 1

  const fatal = (event: string, prefix: string, error: unknown): void => {
    writeToStderr(prefix, error)
    const handledElsewhere = someoneElseHandles(event)
    try {
      logger.fatal(error, { 'nekolog.hook': event })
    } catch (failure) {
      report(failure)
    }
    void flushQuietly().then(() => {
      if (exitOnFatal && !handledElsewhere) {
        target.exit(1)
      }
    })
  }

  if (options.uncaughtException !== false) {
    listen('uncaughtException', (...args) => {
      fatal('uncaughtException', 'Uncaught exception:', args[0])
    })
  }

  if (options.unhandledRejection !== false) {
    listen('unhandledRejection', (...args) => {
      fatal('unhandledRejection', 'Unhandled rejection:', args[0])
    })
  }

  for (const signal of signals) {
    listen(signal, () => {
      const handledElsewhere = someoneElseHandles(signal)
      void flushQuietly().then(() => {
        if (handledElsewhere) {
          return
        }
        uninstall()
        target.kill(target.pid, signal)
      })
    })
  }

  if (options.beforeExit !== false) {
    const onBeforeExit: ProcessListener = () => {
      target.removeListener('beforeExit', onBeforeExit)
      void flushQuietly()
    }
    listen('beforeExit', onBeforeExit)
  }

  return uninstall
}
