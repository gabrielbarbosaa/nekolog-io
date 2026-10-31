import { buildEvent, mergeContexts } from './event.ts'
import { isLogLevel, passesThreshold } from './levels.ts'
import { DEFAULT_SERVICE, MAX_RELEASE_CHARS, MAX_SERVICE_CHARS } from './limits.ts'
import { detectRuntime, isRuntime } from './runtime.ts'
import { consoleSink, globalConsole } from './sinks.ts'
import { createTransport } from './transport.ts'
import type {
  AttributeInput,
  LogContext,
  Logger,
  LoggerOptions,
  LogLevel,
  Resource,
  Sdk,
  Sink,
} from './types.ts'
import { SDK_NAME, SDK_VERSION } from './version.ts'

export const DEFAULT_LEVEL: LogLevel = 'info'

function reportFailure(onError: ((error: unknown) => void) | undefined, error: unknown): void {
  if (!onError) {
    return
  }
  try {
    onError(error)
  } catch {
    return
  }
}

function defaultOnError(error: unknown): void {
  const target = globalConsole()
  const write = target?.warn ?? target?.log
  if (!write) {
    return
  }
  try {
    write.call(target, '[nekolog] the logger swallowed an internal error', error)
  } catch {
    return
  }
}

function resourceFrom(options: LoggerOptions): Resource {
  const service =
    typeof options.service === 'string' && options.service !== ''
      ? options.service.slice(0, MAX_SERVICE_CHARS)
      : DEFAULT_SERVICE

  const resource: Resource = {
    service,
    runtime: isRuntime(options.runtime) ? options.runtime : detectRuntime(),
  }

  if (typeof options.release === 'string' && options.release !== '') {
    resource.release = options.release.slice(0, MAX_RELEASE_CHARS)
  }

  return resource
}

function sdkFrom(options: LoggerOptions): Sdk {
  const name = options.sdk?.name
  const version = options.sdk?.version
  return {
    name: typeof name === 'string' && name !== '' ? name : SDK_NAME,
    version: typeof version === 'string' && version !== '' ? version : SDK_VERSION,
  }
}

type Shared = {
  resource: Resource
  sdk: Sdk
  sink: Sink
  enabled: boolean
  level: LogLevel
  onError: (error: unknown) => void
  now: () => number
}

function createChild(shared: Shared, context: LogContext): Logger {
  const emit = (level: LogLevel, subject: unknown, attributes?: AttributeInput): void => {
    try {
      if (!shared.enabled || !isLogLevel(level) || !passesThreshold(level, shared.level)) {
        return
      }
      shared.sink.emit(buildEvent({ level, subject, attributes, context, timestamp: shared.now() }))
    } catch (error) {
      reportFailure(shared.onError, error)
    }
  }

  return {
    get level() {
      return shared.level
    },
    get resource() {
      return shared.resource
    },
    get sdk() {
      return shared.sdk
    },
    get context() {
      return context
    },
    trace: (message, attributes) => emit('trace', message, attributes),
    debug: (message, attributes) => emit('debug', message, attributes),
    info: (message, attributes) => emit('info', message, attributes),
    warn: (message, attributes) => emit('warn', message, attributes),
    error: (message, attributes) => emit('error', message, attributes),
    fatal: (message, attributes) => emit('fatal', message, attributes),
    log: (level, message, attributes) => emit(level, message, attributes),
    isLevelEnabled(level) {
      return shared.enabled && isLogLevel(level) && passesThreshold(level, shared.level)
    },
    setLevel(level) {
      if (isLogLevel(level)) {
        shared.level = level
      } else {
        reportFailure(shared.onError, new Error(`Ignored an unknown log level: ${String(level)}`))
      }
    },
    child(extra) {
      try {
        return createChild(shared, mergeContexts(context, extra ?? {}))
      } catch (error) {
        reportFailure(shared.onError, error)
        return createChild(shared, context)
      }
    },
    async flush() {
      try {
        await shared.sink.flush?.()
      } catch (error) {
        reportFailure(shared.onError, error)
      }
    },
  }
}

function sinkFrom(options: LoggerOptions, resource: Resource, sdk: Sdk): Sink {
  if (options.sink) {
    return options.sink
  }
  if (typeof options.apiKey === 'string' && options.apiKey !== '') {
    return createTransport({
      ...options.transport,
      apiKey: options.apiKey,
      resource,
      sdk,
      onError: options.onError ?? defaultOnError,
    })
  }
  return consoleSink()
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const resource = resourceFrom(options)
  const sdk = sdkFrom(options)

  const shared: Shared = {
    resource,
    sdk,
    sink: sinkFrom(options, resource, sdk),
    enabled: options.enabled !== false,
    level: isLogLevel(options.level) ? options.level : DEFAULT_LEVEL,
    onError: options.onError ?? defaultOnError,
    now: options.now ?? Date.now,
  }

  return createChild(shared, options.context ?? {})
}
