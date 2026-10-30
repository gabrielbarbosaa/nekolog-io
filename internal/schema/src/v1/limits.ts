export const SCHEMA_VERSION = 1

export const SUPPORTED_SCHEMA_VERSIONS = [1] as const

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const

export const RUNTIMES = ['browser', 'node', 'edge', 'bun', 'deno'] as const

export const MIN_EVENTS_PER_BATCH = 1
export const MAX_EVENTS_PER_BATCH = 500
export const MAX_BATCH_BYTES = 512 * 1024

export const MAX_SDK_NAME_CHARS = 64
export const MAX_SDK_VERSION_CHARS = 64

export const DEFAULT_SERVICE = 'default'
export const MAX_SERVICE_CHARS = 128
export const MAX_RELEASE_CHARS = 64

export const MAX_MESSAGE_BYTES = 16 * 1024

export const MAX_ATTRIBUTE_KEYS = 100
export const MAX_ATTRIBUTE_KEY_CHARS = 128
export const MAX_ATTRIBUTE_VALUE_BYTES = 4 * 1024
export const ATTRIBUTE_KEY_PATTERN = /^[A-Za-z0-9_.-]+$/

export const TRACE_ID_CHARS = 32
export const SPAN_ID_CHARS = 16

export const MAX_SESSION_ID_CHARS = 64
export const MAX_USER_ID_CHARS = 128

export const MAX_ERROR_TYPE_CHARS = 256
export const MAX_ERROR_MESSAGE_BYTES = 4 * 1024
export const MAX_ERROR_STACK_BYTES = 32 * 1024

export const MAX_FINGERPRINT_ITEMS = 5

export type LogLevel = (typeof LOG_LEVELS)[number]
export type Runtime = (typeof RUNTIMES)[number]
