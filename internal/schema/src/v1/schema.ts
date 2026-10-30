import * as v from 'valibot'
import {
  ATTRIBUTE_KEY_PATTERN,
  LOG_LEVELS,
  MAX_ATTRIBUTE_KEY_CHARS,
  MAX_ATTRIBUTE_KEYS,
  MAX_ATTRIBUTE_VALUE_BYTES,
  MAX_ERROR_MESSAGE_BYTES,
  MAX_ERROR_STACK_BYTES,
  MAX_ERROR_TYPE_CHARS,
  MAX_EVENTS_PER_BATCH,
  MAX_FINGERPRINT_ITEMS,
  MAX_RELEASE_CHARS,
  MAX_SDK_NAME_CHARS,
  MAX_SDK_VERSION_CHARS,
  MAX_SERVICE_CHARS,
  MAX_SESSION_ID_CHARS,
  MAX_USER_ID_CHARS,
  MIN_EVENTS_PER_BATCH,
  RUNTIMES,
  SPAN_ID_CHARS,
  SUPPORTED_SCHEMA_VERSIONS,
  TRACE_ID_CHARS,
} from './limits'
import { utf8ByteLength } from './utf8'

function maxBytes(limit: number) {
  return v.check((value: string) => utf8ByteLength(value) <= limit, `Exceeds ${limit} bytes`)
}

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const RFC3339_UTC_MS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

const HEX_PATTERN = /^[0-9a-f]+$/i

const boundedString = (maxChars: number) =>
  v.pipe(v.string(), v.minLength(1), v.maxLength(maxChars))

export const batchIdSchema = v.pipe(v.string(), v.regex(UUID_V7_PATTERN, 'Expected a UUID v7'))

export const timestampSchema = v.pipe(
  v.string(),
  v.regex(RFC3339_UTC_MS_PATTERN, 'Expected RFC 3339 UTC with milliseconds'),
  v.check((value) => !Number.isNaN(Date.parse(value)), 'Not a real date'),
)

export const levelSchema = v.picklist(LOG_LEVELS)

export const messageSchema = v.pipe(v.string(), v.minLength(1))

export const attributeValueSchema = v.union([
  v.pipe(v.string(), maxBytes(MAX_ATTRIBUTE_VALUE_BYTES)),
  v.pipe(v.number(), v.finite()),
  v.boolean(),
  v.null(),
])

export const attributesSchema = v.pipe(
  v.record(
    v.pipe(
      v.string(),
      v.maxLength(MAX_ATTRIBUTE_KEY_CHARS),
      v.regex(ATTRIBUTE_KEY_PATTERN, 'Invalid attribute key'),
    ),
    attributeValueSchema,
  ),
  v.check(
    (value) => Object.keys(value).length <= MAX_ATTRIBUTE_KEYS,
    `More than ${MAX_ATTRIBUTE_KEYS} attribute keys`,
  ),
)

export const traceSchema = v.object({
  traceId: v.pipe(v.string(), v.length(TRACE_ID_CHARS), v.regex(HEX_PATTERN)),
  spanId: v.pipe(v.string(), v.length(SPAN_ID_CHARS), v.regex(HEX_PATTERN)),
})

export const sessionSchema = v.object({
  id: v.optional(boundedString(MAX_SESSION_ID_CHARS)),
  userId: v.optional(boundedString(MAX_USER_ID_CHARS)),
})

export const errorSchema = v.object({
  type: v.optional(boundedString(MAX_ERROR_TYPE_CHARS)),
  message: v.optional(v.pipe(v.string(), maxBytes(MAX_ERROR_MESSAGE_BYTES))),
  stack: v.optional(v.pipe(v.string(), maxBytes(MAX_ERROR_STACK_BYTES))),
})

export const fingerprintSchema = v.pipe(
  v.array(v.pipe(v.string(), v.minLength(1))),
  v.maxLength(MAX_FINGERPRINT_ITEMS),
)

export const eventSchema = v.object({
  timestamp: timestampSchema,
  level: levelSchema,
  message: messageSchema,
  attributes: v.optional(attributesSchema),
  trace: v.optional(traceSchema),
  session: v.optional(sessionSchema),
  error: v.optional(errorSchema),
  fingerprint: v.optional(fingerprintSchema),
})

export const sdkSchema = v.object({
  name: boundedString(MAX_SDK_NAME_CHARS),
  version: boundedString(MAX_SDK_VERSION_CHARS),
})

export const resourceSchema = v.object({
  service: v.optional(boundedString(MAX_SERVICE_CHARS)),
  release: v.optional(boundedString(MAX_RELEASE_CHARS)),
  runtime: v.picklist(RUNTIMES),
})

export const schemaVersionSchema = v.picklist(SUPPORTED_SCHEMA_VERSIONS)

export const envelopeSchema = v.object({
  schemaVersion: schemaVersionSchema,
  batchId: batchIdSchema,
  sdk: sdkSchema,
  resource: resourceSchema,
  events: v.pipe(
    v.array(v.unknown()),
    v.minLength(MIN_EVENTS_PER_BATCH),
    v.maxLength(MAX_EVENTS_PER_BATCH),
  ),
})

export type LogEvent = v.InferOutput<typeof eventSchema>
export type Sdk = v.InferOutput<typeof sdkSchema>
export type Resource = v.InferOutput<typeof resourceSchema>
export type Envelope = v.InferOutput<typeof envelopeSchema>
export type AttributeValue = v.InferOutput<typeof attributeValueSchema>
