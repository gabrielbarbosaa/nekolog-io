import { ApiError } from './errors.ts'

export const MAX_BODY_BYTES = 4 * 1024
export const ACCEPTED_CONTENT_TYPE = 'application/json'

function declaredContentType(request: Request): string {
  return (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  if (declaredContentType(request) !== ACCEPTED_CONTENT_TYPE) {
    throw new ApiError('unsupported_media_type', `This route reads ${ACCEPTED_CONTENT_TYPE}.`)
  }

  const declared = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new ApiError('payload_too_large', `A body here is at most ${MAX_BODY_BYTES} bytes.`)
  }

  const raw = await request.arrayBuffer()
  if (raw.byteLength > MAX_BODY_BYTES) {
    throw new ApiError('payload_too_large', `A body here is at most ${MAX_BODY_BYTES} bytes.`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    throw new ApiError('invalid_query', 'That body is not JSON.')
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError('invalid_query', 'That body is not a JSON object.')
  }

  return parsed as Record<string, unknown>
}
