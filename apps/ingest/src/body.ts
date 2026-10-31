import { MAX_BATCH_BYTES } from '@internal/schema'

export const ACCEPTED_CONTENT_TYPES: readonly string[] = ['application/json', 'text/plain']

export type BodyFailure =
  | { code: 'payload_too_large'; message: string }
  | { code: 'invalid_payload'; message: string }

export type BodyResult = { ok: true; value: unknown } | ({ ok: false } & BodyFailure)

function tooLarge(): BodyResult {
  return {
    ok: false,
    code: 'payload_too_large',
    message: `Batch exceeds ${MAX_BATCH_BYTES} bytes`,
  }
}

function invalid(message: string): BodyResult {
  return { ok: false, code: 'invalid_payload', message }
}

export function declaredContentType(header: string | null): string {
  return (header ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
}

export function isAcceptedContentType(header: string | null): boolean {
  const type = declaredContentType(header)
  return type === '' || ACCEPTED_CONTENT_TYPES.includes(type)
}

export function isGzip(header: string | null): boolean {
  return (header ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .includes('gzip')
}

export function declaredLengthExceeds(header: string | null, limit: number): boolean {
  if (header === null) {
    return false
  }
  const length = Number(header)
  return Number.isFinite(length) && length > limit
}

async function readCapped(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array | null> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      total += value.byteLength
      if (total > limit) {
        return null
      }
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function decompressor(): DecompressionStream | null {
  const available = (globalThis as { DecompressionStream?: typeof DecompressionStream })
    .DecompressionStream
  return available ? new available('gzip') : null
}

export type ReadBodyOptions = {
  limitBytes?: number
  streamOf?: (bytes: Uint8Array) => ReadableStream<Uint8Array>
}

function streamFrom(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const body = new Response(bytes).body
  if (body === null) {
    throw new Error('This runtime cannot turn bytes back into a stream')
  }
  return body
}

export async function readBatchBody(
  request: Request,
  options: ReadBodyOptions = {},
): Promise<BodyResult> {
  const limit = options.limitBytes ?? MAX_BATCH_BYTES

  if (!isAcceptedContentType(request.headers.get('content-type'))) {
    return invalid('Content-Type must be application/json or text/plain')
  }

  if (declaredLengthExceeds(request.headers.get('content-length'), limit)) {
    return tooLarge()
  }

  if (request.body === null) {
    return invalid('Body is empty')
  }

  const raw = await readCapped(request.body, limit)
  if (raw === null) {
    return tooLarge()
  }

  const gzip = isGzip(request.headers.get('content-encoding'))
  let bytes = raw

  if (gzip) {
    const stream = decompressor()
    if (stream === null) {
      return invalid('This runtime cannot decompress gzip')
    }
    const toStream = options.streamOf ?? streamFrom
    let decompressed: Uint8Array | null
    try {
      decompressed = await readCapped(toStream(raw).pipeThrough(stream), limit)
    } catch {
      return invalid('Body is not valid gzip')
    }
    if (decompressed === null) {
      return tooLarge()
    }
    bytes = decompressed
  }

  if (bytes.byteLength === 0) {
    return invalid('Body is empty')
  }

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return invalid('Body is not valid UTF-8')
  }

  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return invalid('Body is not valid JSON')
  }
}
