import { memorySink } from '@nekolog-io/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from './logger.ts'
import { SDK_NAME, SDK_VERSION } from './version.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('createLogger', () => {
  it('reports itself as the node sdk', () => {
    const logger = createLogger({ sink: memorySink() })

    expect(logger.sdk).toEqual({ name: SDK_NAME, version: SDK_VERSION })
    expect(logger.resource.runtime).toBe('node')
  })

  it('picks the ambient context up without being wired to it', () => {
    const sink = memorySink()
    const logger = createLogger({ sink })

    expect(logger.resource.service).toBe('default')
    expect(sink.events).toEqual([])
  })

  it('reads the service, release and level from the environment', () => {
    vi.stubEnv('NEKOLOG_SERVICE', 'checkout-api')
    vi.stubEnv('NEKOLOG_RELEASE', '1.4.2')
    vi.stubEnv('NEKOLOG_LEVEL', 'DEBUG')

    const sink = memorySink()
    const logger = createLogger({ sink })
    logger.debug('visible')

    expect(logger.resource).toMatchObject({ service: 'checkout-api', release: '1.4.2' })
    expect(sink.events).toHaveLength(1)
  })

  it('lets explicit options beat the environment', () => {
    vi.stubEnv('NEKOLOG_SERVICE', 'from-env')

    const logger = createLogger({ sink: memorySink(), service: 'from-code' })

    expect(logger.resource.service).toBe('from-code')
  })

  it('ignores a blank environment variable instead of taking it literally', () => {
    vi.stubEnv('NEKOLOG_SERVICE', '   ')

    const logger = createLogger({ sink: memorySink() })

    expect(logger.resource.service).toBe('default')
  })

  it('keeps the default level and reports an unusable NEKOLOG_LEVEL', () => {
    vi.stubEnv('NEKOLOG_LEVEL', 'verbose')
    const onError = vi.fn()

    const sink = memorySink()
    const logger = createLogger({ sink, onError })
    logger.debug('dropped')
    logger.info('kept')

    expect(logger.level).toBe('info')
    expect(sink.events.map((event) => event.message)).toEqual(['kept'])
    expect(String(onError.mock.calls[0]?.[0])).toContain('NEKOLOG_LEVEL')
  })

  it('sends to the endpoint the environment names', async () => {
    const calls: string[] = []
    vi.stubEnv('NEKOLOG_KEY', 'nekolog_sk_0123456789abcdef')
    vi.stubEnv('NEKOLOG_ENDPOINT', 'https://logs.internal')
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url)
      return {
        ok: true,
        status: 202,
        headers: { get: () => null },
        text: async () => '{"accepted":1,"rejected":[]}',
      }
    })

    const logger = createLogger({ transport: { flushIntervalMs: 0 } })
    logger.info('hello')
    await logger.flush()
    vi.unstubAllGlobals()

    expect(calls).toEqual(['https://logs.internal/v1/logs'])
  })

  it('writes to the console when no key is anywhere to be found', () => {
    const write = vi.fn()
    vi.stubGlobal('console', { info: write })

    createLogger().info('hello')
    vi.unstubAllGlobals()

    expect(write).toHaveBeenCalled()
  })
})
