export const OTLP_SEVERITY_LEVELS: readonly string[] = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
]

export const MAX_OTLP_RECORDS = 500
export const MAX_OTLP_BODY_CHARS = 16 * 1024
export const MAX_OTLP_ATTRIBUTE_DEPTH = 3

export const SERVICE_NAME_KEY = 'service.name'
export const SERVICE_VERSION_KEY = 'service.version'
export const LANGUAGE_KEY = 'telemetry.sdk.language'

export const RUNTIMES: Readonly<Record<string, string>> = {
  nodejs: 'node',
  node: 'node',
  javascript: 'browser',
  webjs: 'browser',
  browser: 'browser',
  deno: 'deno',
  bun: 'bun',
}

export const DEFAULT_RUNTIME = 'node'
export const DEFAULT_SERVICE = 'default'

const TRACE_ID = /^[0-9a-f]{32}$/
const SPAN_ID = /^[0-9a-f]{16}$/
const ATTRIBUTE_KEY = /^[A-Za-z0-9_.-]{1,128}$/

export class OtlpError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'OtlpError'
  }
}

export function levelFor(severityNumber: unknown, severityText: unknown): string {
  if (typeof severityNumber === 'number' && severityNumber >= 1 && severityNumber <= 24) {
    return OTLP_SEVERITY_LEVELS[Math.floor((severityNumber - 1) / 4)] ?? 'info'
  }

  if (typeof severityText === 'string') {
    const lowered = severityText.toLowerCase()
    if (OTLP_SEVERITY_LEVELS.includes(lowered)) {
      return lowered
    }
    if (lowered === 'warning') {
      return 'warn'
    }
  }

  return 'info'
}

export function millisFrom(nanos: unknown): number | null {
  if (typeof nanos === 'number' && Number.isFinite(nanos) && nanos > 0) {
    return Math.floor(nanos / 1e6)
  }
  if (typeof nanos === 'string' && /^\d{1,21}$/.test(nanos) && nanos !== '0') {
    return Number(BigInt(nanos) / 1000000n)
  }
  return null
}

export function anyValue(value: unknown, depth = 0): string | number | boolean | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const one = value as Record<string, unknown>

  if (typeof one.stringValue === 'string') {
    return one.stringValue
  }
  if (typeof one.boolValue === 'boolean') {
    return one.boolValue
  }
  if (typeof one.doubleValue === 'number') {
    return one.doubleValue
  }
  if (typeof one.intValue === 'number') {
    return one.intValue
  }
  if (typeof one.intValue === 'string' && /^-?\d{1,20}$/.test(one.intValue)) {
    return one.intValue
  }
  if (typeof one.bytesValue === 'string') {
    return one.bytesValue
  }

  if (depth >= MAX_OTLP_ATTRIBUTE_DEPTH) {
    return null
  }

  if (Array.isArray((one.arrayValue as { values?: unknown })?.values)) {
    const values = (one.arrayValue as { values: unknown[] }).values
      .map((item) => anyValue(item, depth + 1))
      .filter((item) => item !== null)
    return JSON.stringify(values)
  }

  if (Array.isArray((one.kvlistValue as { values?: unknown })?.values)) {
    return JSON.stringify(
      attributesFrom((one.kvlistValue as { values: unknown[] }).values, depth + 1),
    )
  }

  return null
}

export function attributesFrom(
  list: unknown,
  depth = 0,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  if (!Array.isArray(list)) {
    return out
  }

  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const { key, value } = entry as { key?: unknown; value?: unknown }
    if (typeof key !== 'string' || !ATTRIBUTE_KEY.test(key)) {
      continue
    }
    const read = anyValue(value, depth)
    if (read !== null) {
      out[key] = read
    }
  }

  return out
}

export function bodyText(body: unknown): string {
  const read = anyValue(body)
  if (read === null) {
    return ''
  }
  const text = typeof read === 'string' ? read : String(read)
  return text.length > MAX_OTLP_BODY_CHARS ? text.slice(0, MAX_OTLP_BODY_CHARS) : text
}

export type OtlpTranslation = {
  resource: { service: string; release?: string; runtime: string }
  events: Array<Record<string, unknown>>
  dropped: number
}

function traceOf(record: Record<string, unknown>): { traceId: string; spanId: string } | undefined {
  const traceId = typeof record.traceId === 'string' ? record.traceId.toLowerCase() : ''
  const spanId = typeof record.spanId === 'string' ? record.spanId.toLowerCase() : ''
  if (!TRACE_ID.test(traceId) || !SPAN_ID.test(spanId)) {
    return undefined
  }
  return { traceId, spanId }
}

export function translateOtlp(payload: unknown, receivedAt: number): OtlpTranslation {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new OtlpError('An OTLP request body is a JSON object')
  }

  const resourceLogs = (payload as { resourceLogs?: unknown }).resourceLogs
  if (!Array.isArray(resourceLogs)) {
    throw new OtlpError('An OTLP request carries a resourceLogs list')
  }

  const events: Array<Record<string, unknown>> = []
  let dropped = 0
  let service = ''
  let release = ''
  let runtime = ''

  for (const group of resourceLogs) {
    if (typeof group !== 'object' || group === null) {
      continue
    }

    const resourceAttributes = attributesFrom(
      (group as { resource?: { attributes?: unknown } }).resource?.attributes,
    )

    if (service === '' && typeof resourceAttributes[SERVICE_NAME_KEY] === 'string') {
      service = resourceAttributes[SERVICE_NAME_KEY] as string
    }
    if (release === '' && typeof resourceAttributes[SERVICE_VERSION_KEY] === 'string') {
      release = resourceAttributes[SERVICE_VERSION_KEY] as string
    }
    if (runtime === '' && typeof resourceAttributes[LANGUAGE_KEY] === 'string') {
      runtime = RUNTIMES[(resourceAttributes[LANGUAGE_KEY] as string).toLowerCase()] ?? ''
    }

    const scopeLogs = (group as { scopeLogs?: unknown }).scopeLogs
    if (!Array.isArray(scopeLogs)) {
      continue
    }

    for (const scope of scopeLogs) {
      const records = (scope as { logRecords?: unknown })?.logRecords
      if (!Array.isArray(records)) {
        continue
      }

      for (const entry of records) {
        if (typeof entry !== 'object' || entry === null) {
          dropped += 1
          continue
        }

        if (events.length >= MAX_OTLP_RECORDS) {
          dropped += 1
          continue
        }

        const record = entry as Record<string, unknown>
        const at = millisFrom(record.timeUnixNano) ?? millisFrom(record.observedTimeUnixNano)
        const message = bodyText(record.body)

        if (message === '') {
          dropped += 1
          continue
        }

        const attributes = {
          ...resourceAttributes,
          ...attributesFrom(record.attributes),
        }
        delete attributes[SERVICE_NAME_KEY]
        delete attributes[SERVICE_VERSION_KEY]

        const trace = traceOf(record)

        events.push({
          timestamp: new Date(at ?? receivedAt).toISOString(),
          level: levelFor(record.severityNumber, record.severityText),
          message,
          ...(Object.keys(attributes).length === 0 ? {} : { attributes }),
          ...(trace === undefined ? {} : { trace }),
        })
      }
    }
  }

  return {
    resource: {
      service: service === '' ? DEFAULT_SERVICE : service,
      ...(release === '' ? {} : { release }),
      runtime: runtime === '' ? DEFAULT_RUNTIME : runtime,
    },
    events,
    dropped,
  }
}
