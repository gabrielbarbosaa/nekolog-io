export { flattenAttributes, mergeAttributeInputs, sanitiseKey } from './attributes.ts'
export { describe, errorInfoOf, isErrorLike } from './errors.ts'
export {
  buildEvent,
  isoTimestamp,
  mergeContexts,
  normaliseFingerprint,
  normaliseMessage,
  normaliseSession,
  normaliseTrace,
} from './event.ts'
export { isLogLevel, levelRank, passesThreshold } from './levels.ts'
export {
  DEFAULT_SERVICE,
  LOG_LEVELS,
  MAX_ATTRIBUTE_KEY_CHARS,
  MAX_ATTRIBUTE_KEYS,
  MAX_ATTRIBUTE_VALUE_BYTES,
  MAX_ERROR_MESSAGE_BYTES,
  MAX_ERROR_STACK_BYTES,
  MAX_ERROR_TYPE_CHARS,
  MAX_FINGERPRINT_ITEMS,
  MAX_MESSAGE_BYTES,
  RUNTIMES,
  SCHEMA_VERSION,
} from './limits.ts'
export { createLogger, DEFAULT_LEVEL } from './logger.ts'
export { detectRuntime, isRuntime } from './runtime.ts'
export type { ConsoleLike } from './sinks.ts'
export { consoleSink, memorySink, nullSink } from './sinks.ts'
export type {
  AttributeInput,
  Attributes,
  AttributeValue,
  ErrorInfo,
  LogContext,
  LogEvent,
  Logger,
  LoggerOptions,
  LogLevel,
  Resource,
  Runtime,
  Sdk,
  SessionContext,
  Sink,
  TraceContext,
} from './types.ts'
export { truncateToUtf8Bytes, utf8ByteLength } from './utf8.ts'
export { SDK_NAME, SDK_VERSION } from './version.ts'
