import type { LOG_LEVELS, RUNTIMES } from './limits.ts'

export type LogLevel = (typeof LOG_LEVELS)[number]
export type Runtime = (typeof RUNTIMES)[number]

export type AttributeValue = string | number | boolean | null

export type Attributes = Record<string, AttributeValue>

export type AttributeInput = Record<string, unknown>

export type TraceContext = {
  traceId: string
  spanId: string
}

export type SessionContext = {
  id?: string
  userId?: string
}

export type ErrorInfo = {
  type?: string
  message?: string
  stack?: string
}

export type LogEvent = {
  timestamp: string
  level: LogLevel
  message: string
  attributes?: Attributes
  trace?: TraceContext
  session?: SessionContext
  error?: ErrorInfo
  fingerprint?: string[]
}

export type Sdk = {
  name: string
  version: string
}

export type Resource = {
  service?: string
  release?: string
  runtime: Runtime
}

export type LogContext = {
  attributes?: AttributeInput
  trace?: TraceContext
  session?: SessionContext
  fingerprint?: string[]
}

export type Sink = {
  emit(event: LogEvent): void
  flush?(): Promise<void>
}

export type TransportTuning = {
  endpoint?: string
  maxQueueEvents?: number
  maxBatchEvents?: number
  maxBatchBytes?: number
  flushIntervalMs?: number
  maxRetries?: number
  baseRetryDelayMs?: number
  maxRetryDelayMs?: number
}

export type SamplingTuning = {
  rate?: number
  alwaysFrom?: LogLevel | false
}

export type PrivacyTuning = {
  enabled?: boolean
  extraKeys?: string[]
  skipKeys?: string[]
  extraPatterns?: RegExp[]
  scrubText?: boolean
}

export type BeforeSend = (event: LogEvent) => LogEvent | null | false | undefined

export type LoggerOptions = {
  apiKey?: string
  transport?: TransportTuning
  sampling?: SamplingTuning
  privacy?: PrivacyTuning
  beforeSend?: BeforeSend
  random?: () => number
  contextProvider?: () => LogContext | undefined
  service?: string
  release?: string
  runtime?: Runtime
  level?: LogLevel
  enabled?: boolean
  context?: LogContext
  sdk?: Sdk
  sink?: Sink
  onError?: (error: unknown) => void
  now?: () => number
}

export type Logger = {
  readonly level: LogLevel
  readonly resource: Resource
  readonly sdk: Sdk
  readonly context: LogContext
  trace(message: unknown, attributes?: AttributeInput): void
  debug(message: unknown, attributes?: AttributeInput): void
  info(message: unknown, attributes?: AttributeInput): void
  warn(message: unknown, attributes?: AttributeInput): void
  error(message: unknown, attributes?: AttributeInput): void
  fatal(message: unknown, attributes?: AttributeInput): void
  log(level: LogLevel, message: unknown, attributes?: AttributeInput): void
  isLevelEnabled(level: LogLevel): boolean
  setLevel(level: LogLevel): void
  child(context: LogContext): Logger
  flush(): Promise<void>
}
