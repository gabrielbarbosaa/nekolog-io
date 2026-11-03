import { consoleSink, createLogger, type Logger } from '@nekolog-io/core'
import { createContext, useContext } from 'react'

export const NO_PROVIDER =
  'useLogger was called outside a NekologProvider, so the log went to the console. Wrap the tree in <NekologProvider>.'

export const LoggerContext: ReturnType<typeof createContext<Logger | null>> =
  createContext<Logger | null>(null)

let fallback: Logger | undefined
let warned = false

export function fallbackLogger(): Logger {
  if (fallback === undefined) {
    fallback = createLogger({ sink: consoleSink() })
  }
  return fallback
}

export function resetFallback(): void {
  fallback = undefined
  warned = false
}

function warnOnce(onError: ((error: unknown) => void) | undefined): void {
  if (warned) {
    return
  }
  warned = true
  const report =
    onError ??
    ((error: unknown) => {
      const target = (globalThis as { console?: { warn?: (...args: unknown[]) => void } }).console
      target?.warn?.('[nekolog]', error)
    })
  try {
    report(new Error(NO_PROVIDER))
  } catch {
    return
  }
}

export function useLogger(): Logger {
  const logger = useContext(LoggerContext)
  if (logger !== null) {
    return logger
  }
  warnOnce(undefined)
  return fallbackLogger()
}
