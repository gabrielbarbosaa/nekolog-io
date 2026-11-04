import { describe, expect, it } from 'vitest'
import { ACCEPTED_CONTENT_TYPE, MAX_BODY_BYTES, readJsonObject } from './body.ts'
import type { ApiError } from './errors.ts'

function posting(body: string, contentType: string | null = ACCEPTED_CONTENT_TYPE): Request {
  return new Request('https://api.test/v1/releases', {
    method: 'POST',
    headers: contentType === null ? {} : { 'content-type': contentType },
    body,
  })
}

async function refusal(request: Request): Promise<ApiError> {
  try {
    await readJsonObject(request)
  } catch (error) {
    return error as ApiError
  }
  throw new Error('that body should have been refused')
}

describe('the body the one writing route reads', () => {
  it('reads a JSON object', async () => {
    expect(await readJsonObject(posting('{"version":"1.4.2"}'))).toEqual({ version: '1.4.2' })
  })

  it('refuses anything that is not a JSON object, an array most of all', async () => {
    for (const body of ['[]', '[{"version":"1.4.2"}]', '"1.4.2"', '42', 'null', 'true']) {
      const error = await refusal(posting(body))
      expect(error.code, body).toBe('invalid_query')
      expect(error.message, body).toContain('JSON object')
    }
  })

  it('refuses a body that is not JSON at all', async () => {
    const error = await refusal(posting('version=1.4.2'))

    expect(error.code).toBe('invalid_query')
    expect(error.message).toContain('not JSON')
  })

  it('refuses a content type it did not ask for, and none at all', async () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', null]) {
      const error = await refusal(posting('{"version":"1.4.2"}', type))
      expect(error.code, String(type)).toBe('unsupported_media_type')
    }

    await expect(
      readJsonObject(posting('{"version":"1.4.2"}', 'application/json; charset=utf-8')),
    ).resolves.toEqual({ version: '1.4.2' })
  })

  it('refuses a body over the limit, by what arrived and not only by what was declared', async () => {
    const huge = JSON.stringify({ version: 'x'.repeat(MAX_BODY_BYTES) })

    expect((await refusal(posting(huge))).code).toBe('payload_too_large')

    const lying = new Request('https://api.test/v1/releases', {
      method: 'POST',
      headers: { 'content-type': ACCEPTED_CONTENT_TYPE, 'content-length': '10' },
      body: huge,
    })
    expect((await refusal(lying)).code).toBe('payload_too_large')
  })

  it('accepts a body right at the limit', async () => {
    const padding = 'x'.repeat(MAX_BODY_BYTES - '{"version":"1.4.2","p":""}'.length)
    const body = JSON.stringify({ version: '1.4.2', p: padding })

    expect(body.length).toBeLessThanOrEqual(MAX_BODY_BYTES)
    await expect(readJsonObject(posting(body))).resolves.toMatchObject({ version: '1.4.2' })
  })
})
