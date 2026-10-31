import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'hooked.ts')

const SIGNALS_ARE_DELIVERABLE = process.platform !== 'win32'

if (!SIGNALS_ARE_DELIVERABLE) {
  process.stderr.write(
    '[nekolog] skipping the real SIGTERM test: Windows terminates the process instead of delivering the signal to a listener. CI runs on Linux, where it does run.\n',
  )
}

type Run = { code: number | null; signal: string | null; out: string; err: string }

function run(mode: string): Promise<Run> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [FIXTURE, mode], { stdio: 'pipe' })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => {
      out += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      err += String(chunk)
    })
    child.on('close', (code, signal) => done({ code, signal, out, err }))
  })
}

describe('a real node process with the hooks installed', () => {
  it('flushes before letting an uncaught exception kill it', async () => {
    const result = await run('uncaught')

    expect(result.out).toContain('FLUSHED')
    expect(result.out).toContain('"fatal","kaboom"')
    expect(result.out).toContain('"info","before the end"')
    expect(result.out).toContain('"requestId":"r-1"')
    expect(result.code).toBe(1)
  }, 20_000)

  it('leaves the stack on stderr, where Node would have put it', async () => {
    const result = await run('uncaught')

    expect(result.err).toContain('Uncaught exception:')
    expect(result.err).toContain('kaboom')
  }, 20_000)

  it('crashes the same way with no hooks at all, so the hooks changed nothing', async () => {
    const result = await run('bare')

    expect(result.code).toBe(1)
    expect(result.out).not.toContain('FLUSHED')
  }, 20_000)

  it('flushes on an unhandled rejection and still exits 1', async () => {
    const result = await run('rejection')

    expect(result.out).toContain('FLUSHED')
    expect(result.out).toContain('"fatal","no catch here"')
    expect(result.code).toBe(1)
  }, 20_000)

  it('flushes what is queued when the process ends on its own', async () => {
    const result = await run('none')

    expect(result.out).toContain('"info","before the end"')
    expect(result.code).toBe(0)
  }, 20_000)

  it('flushes on SIGTERM and leaves the shutdown to whoever owns it', async () => {
    const result = await run('graceful')

    expect(result.out).toContain('APP HANDLER RAN')
    expect(result.out).toContain('FLUSHED')
    expect(result.code).toBe(7)
  }, 20_000)

  it.skipIf(!SIGNALS_ARE_DELIVERABLE)(
    'flushes before dying from a real SIGTERM',
    async () => {
      const result = await run('signal')

      expect(result.out).toContain('FLUSHED')
      expect(result.code === 0 && result.signal === null).toBe(false)
    },
    20_000,
  )
})
