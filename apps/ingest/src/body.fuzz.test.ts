import { MAX_BATCH_BYTES } from '@internal/schema'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type BodyResult,
  declaredContentType,
  declaredLengthExceeds,
  isAcceptedContentType,
  isGzip,
  readBatchBody,
} from './body.ts'

const RUNS = Number(process.env.FUZZ_RUNS ?? 200)

const FAILURE_CODES = ['payload_too_large', 'invalid_payload']

const headerText = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc.constantFrom(
    'application/json',
    'APPLICATION/JSON',
    'application/json; charset=utf-8',
    'text/plain',
    'text/plain;charset=UTF-8',
    'application/octet-stream',
    '',
    ' ',
    ';;;',
    'application/json, text/plain',
  ),
)

const encodingHeader = fc.oneof(
  fc.string({ maxLength: 20 }),
  fc.constantFrom('gzip', 'GZIP', ' gzip ', 'gzip, br', 'br, gzip', 'deflate', '', 'gzipped'),
)

const bodyBytes = fc.uint8Array({ maxLength: 512 })

function request(body: Uint8Array, headers: Record<string, string>): Request {
  return new Request('https://ingest.nekolog.io/v1/logs', {
    method: 'POST',
    headers,
    body: body.length === 0 ? null : (body as unknown as RequestInit['body']),
  })
}

function expectWellFormed(result: BodyResult): void {
  if (result.ok) {
    expect('value' in result).toBe(true)
    return
  }
  expect(FAILURE_CODES).toContain(result.code)
  expect(typeof result.message).toBe('string')
  expect(result.message.length).toBeGreaterThan(0)
}

describe('the header readers, fuzzed', () => {
  it('never throw on any header value', () => {
    fc.assert(
      fc.property(fc.option(headerText, { nil: null }), (header) => {
        expect(() => declaredContentType(header)).not.toThrow()
        expect(() => isAcceptedContentType(header)).not.toThrow()
        expect(() => isGzip(header)).not.toThrow()
        expect(() => declaredLengthExceeds(header, MAX_BATCH_BYTES)).not.toThrow()
      }),
      { numRuns: RUNS },
    )
  })

  it('never read a content type as accepted unless it really is one', () => {
    fc.assert(
      fc.property(fc.option(headerText, { nil: null }), (header) => {
        if (isAcceptedContentType(header)) {
          const type = declaredContentType(header)
          expect(['', 'application/json', 'text/plain']).toContain(type)
        }
      }),
      { numRuns: RUNS },
    )
  })

  it('never treat a length header as within the limit when it is not a number below it', () => {
    fc.assert(
      fc.property(fc.oneof(fc.integer(), fc.double(), fc.string({ maxLength: 12 })), (value) => {
        const header = String(value)
        const exceeds = declaredLengthExceeds(header, MAX_BATCH_BYTES)
        const parsed = Number(header)

        expect(exceeds).toBe(Number.isFinite(parsed) && parsed > MAX_BATCH_BYTES)
      }),
      { numRuns: RUNS },
    )
  })

  it('only calls it gzip when gzip is one of the listed encodings', () => {
    fc.assert(
      fc.property(fc.option(encodingHeader, { nil: null }), (header) => {
        const parts = (header ?? '').split(',').map((part) => part.trim().toLowerCase())

        expect(isGzip(header)).toBe(parts.includes('gzip'))
      }),
      { numRuns: RUNS },
    )
  })
})

describe('readBatchBody, fuzzed', () => {
  it('never throws, whatever bytes and headers arrive', async () => {
    await fc.assert(
      fc.asyncProperty(bodyBytes, headerText, encodingHeader, async (body, type, encoding) => {
        const result = await readBatchBody(
          request(body, { 'content-type': type, 'content-encoding': encoding }),
        )

        expectWellFormed(result)
      }),
      { numRuns: RUNS },
    )
  })

  it('never throws on bytes that claim to be gzip and are not', async () => {
    await fc.assert(
      fc.asyncProperty(bodyBytes, async (body) => {
        const result = await readBatchBody(
          request(body, { 'content-type': 'application/json', 'content-encoding': 'gzip' }),
        )

        expectWellFormed(result)
        expect(result.ok).toBe(false)
      }),
      { numRuns: RUNS },
    )
  })

  it('never accepts a body above the limit, however the length is declared', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: MAX_BATCH_BYTES + 1, max: MAX_BATCH_BYTES * 4 }),
        async (declared) => {
          const result = await readBatchBody(
            request(new TextEncoder().encode('{}'), {
              'content-type': 'application/json',
              'content-length': String(declared),
            }),
          )

          expect(result).toMatchObject({ ok: false, code: 'payload_too_large' })
        },
      ),
      { numRuns: 30 },
    )
  })

  it('gives back exactly what JSON.parse would, for any JSON value', async () => {
    await fc.assert(
      fc.asyncProperty(fc.jsonValue(), async (value) => {
        const text = JSON.stringify(value)
        const body = new TextEncoder().encode(text)
        const result = await readBatchBody(request(body, { 'content-type': 'application/json' }))

        expect(result).toEqual({ ok: true, value: JSON.parse(text) })
      }),
      { numRuns: RUNS },
    )
  })

  it('does not promise to keep what JSON itself does not keep', () => {
    expect(JSON.parse(JSON.stringify(-0))).toBe(0)
  })

  it('refuses a content type it does not accept, before reading anything', async () => {
    await fc.assert(
      fc.asyncProperty(headerText, async (type) => {
        if (isAcceptedContentType(type)) {
          return
        }
        const result = await readBatchBody(
          request(new TextEncoder().encode('{}'), { 'content-type': type }),
        )

        expect(result).toMatchObject({ ok: false, code: 'invalid_payload' })
      }),
      { numRuns: RUNS },
    )
  })
})
