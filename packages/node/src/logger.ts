import {
  createLogger as createCoreLogger,
  isLogLevel,
  type Logger,
  type LoggerOptions,
  type LogLevel,
} from '@nekolog-io/core'
import { currentContext } from './context.ts'
import { SDK_NAME, SDK_VERSION } from './version.ts'

export const API_KEY_ENV = 'NEKOLOG_KEY'
export const ENDPOINT_ENV = 'NEKOLOG_ENDPOINT'
export const SERVICE_ENV = 'NEKOLOG_SERVICE'
export const RELEASE_ENV = 'NEKOLOG_RELEASE'
export const LEVEL_ENV = 'NEKOLOG_LEVEL'

export type NodeLoggerOptions = Omit<LoggerOptions, 'runtime' | 'sdk'>

function environment(): Record<string, string | undefined> {
  return (
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
  )
}

function text(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function levelFrom(value: string | undefined, onError: ((error: unknown) => void) | undefined) {
  const candidate = text(value)?.toLowerCase()
  if (candidate === undefined) {
    return undefined
  }
  if (isLogLevel(candidate)) {
    return candidate as LogLevel
  }
  onError?.(new Error(`Ignored an unknown ${LEVEL_ENV}: ${candidate}`))
  return undefined
}

export function createLogger(options: NodeLoggerOptions = {}): Logger {
  const env = environment()
  const apiKey = options.apiKey ?? text(env[API_KEY_ENV])
  const endpoint = options.transport?.endpoint ?? text(env[ENDPOINT_ENV])

  return createCoreLogger({
    ...options,
    runtime: 'node',
    sdk: { name: SDK_NAME, version: SDK_VERSION },
    apiKey,
    service: options.service ?? text(env[SERVICE_ENV]),
    release: options.release ?? text(env[RELEASE_ENV]),
    level: options.level ?? levelFrom(env[LEVEL_ENV], options.onError),
    contextProvider: options.contextProvider ?? currentContext,
    transport: endpoint === undefined ? options.transport : { ...options.transport, endpoint },
  })
}
