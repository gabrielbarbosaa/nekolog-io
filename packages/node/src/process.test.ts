import type { Logger } from '@nekolog-io/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installProcessHooks, type ProcessListener } from './process.ts'

type FakeProcess = {
  pid: number
  on(event: string, listener: ProcessListener): unknown
  removeListener(event: string, listener: ProcessListener): unknown
  listenerCount(event: string): number
  exit: ReturnType<typeof vi.fn<(code?: number) => unknown>>
  kill: ReturnType<typeof vi.fn<(pid: number, signal?: string) => unknown>>
  emit(event: string, ...args: unknown[]): void
  listeners: Map<string, ProcessListener[]>
}

function fakeProcess(): FakeProcess {
  const listeners = new Map<string, ProcessListener[]>()
  return {
    pid: 4242,
    listeners,
    on(event, listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return this
    },
    removeListener(event, listener) {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((entry) => entry !== listener),
      )
      return this
    },
    listenerCount(event) {
      return (listeners.get(event) ?? []).length
    },
    exit: vi.fn<(code?: number) => unknown>(),
    kill: vi.fn<(pid: number, signal?: string) => unknown>(),
    emit(event, ...args) {
      for (const listener of [...(listeners.get(event) ?? [])]) {
        listener(...args)
      }
    },
  }
}

function fakeLogger(flush: () => Promise<void> = async () => undefined) {
  const fatal = vi.fn()
  const logger = { fatal, flush: vi.fn(flush) } as unknown as Logger
  return { logger, fatal, flush: logger.flush as ReturnType<typeof vi.fn> }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

let stderr: ReturnType<typeof vi.fn>

beforeEach(() => {
  stderr = vi.fn()
  vi.stubGlobal('console', { error: stderr })
  return () => {
    vi.unstubAllGlobals()
  }
})

describe('uncaughtException', () => {
  it('logs it, flushes, and still crashes the process', async () => {
    const target = fakeProcess()
    const { logger, fatal, flush } = fakeLogger()
    const boom = new Error('boom')

    installProcessHooks(logger, { target, signals: false })
    target.emit('uncaughtException', boom)
    await settle()

    expect(fatal).toHaveBeenCalledWith(boom, { 'nekolog.hook': 'uncaughtException' })
    expect(flush).toHaveBeenCalled()
    expect(target.exit).toHaveBeenCalledWith(1)
  })

  it('keeps the error on stderr, which is where Node would have put it', () => {
    const target = fakeProcess()
    const boom = new Error('boom')

    installProcessHooks(fakeLogger().logger, { target, signals: false })
    target.emit('uncaughtException', boom)

    expect(stderr).toHaveBeenCalledWith('Uncaught exception:', boom)
  })

  it('does not exit when the app has its own handler', async () => {
    const target = fakeProcess()
    const appHandler = vi.fn()
    target.on('uncaughtException', appHandler)

    installProcessHooks(fakeLogger().logger, { target, signals: false })
    target.emit('uncaughtException', new Error('boom'))
    await settle()

    expect(appHandler).toHaveBeenCalled()
    expect(target.exit).not.toHaveBeenCalled()
  })

  it('can be told not to exit', async () => {
    const target = fakeProcess()

    installProcessHooks(fakeLogger().logger, { target, signals: false, exitOnFatal: false })
    target.emit('uncaughtException', new Error('boom'))
    await settle()

    expect(target.exit).not.toHaveBeenCalled()
  })

  it('exits even when the flush fails', async () => {
    const target = fakeProcess()
    const onError = vi.fn()
    const { logger } = fakeLogger(async () => {
      throw new Error('network down')
    })

    installProcessHooks(logger, { target, signals: false, onError })
    target.emit('uncaughtException', new Error('boom'))
    await settle()

    expect(onError).toHaveBeenCalled()
    expect(target.exit).toHaveBeenCalledWith(1)
  })

  it('exits even when the flush never finishes', async () => {
    vi.useFakeTimers()
    const target = fakeProcess()
    const { logger } = fakeLogger(() => new Promise(() => undefined))

    installProcessHooks(logger, { target, signals: false, flushTimeoutMs: 50 })
    target.emit('uncaughtException', new Error('boom'))
    await vi.advanceTimersByTimeAsync(60)
    vi.useRealTimers()

    expect(target.exit).toHaveBeenCalledWith(1)
  })

  it('still exits when the logger itself throws', async () => {
    const target = fakeProcess()
    const onError = vi.fn()
    const logger = {
      fatal: () => {
        throw new Error('logger broken')
      },
      flush: async () => undefined,
    } as unknown as Logger

    installProcessHooks(logger, { target, signals: false, onError })
    target.emit('uncaughtException', new Error('boom'))
    await settle()

    expect(onError).toHaveBeenCalled()
    expect(target.exit).toHaveBeenCalledWith(1)
  })

  it('can be left alone', () => {
    const target = fakeProcess()

    installProcessHooks(fakeLogger().logger, {
      target,
      signals: false,
      uncaughtException: false,
    })

    expect(target.listenerCount('uncaughtException')).toBe(0)
  })
})

describe('unhandledRejection', () => {
  it('logs the reason and crashes, like Node does', async () => {
    const target = fakeProcess()
    const { logger, fatal } = fakeLogger()
    const reason = new Error('nope')

    installProcessHooks(logger, { target, signals: false })
    target.emit('unhandledRejection', reason, Promise.resolve())
    await settle()

    expect(fatal).toHaveBeenCalledWith(reason, { 'nekolog.hook': 'unhandledRejection' })
    expect(target.exit).toHaveBeenCalledWith(1)
  })
})

describe('signals', () => {
  it('flushes and then lets the signal do what it was going to do', async () => {
    const target = fakeProcess()
    const { logger, flush } = fakeLogger()

    installProcessHooks(logger, { target })
    target.emit('SIGTERM')
    await settle()

    expect(flush).toHaveBeenCalled()
    expect(target.kill).toHaveBeenCalledWith(4242, 'SIGTERM')
    expect(target.listenerCount('SIGTERM')).toBe(0)
  })

  it('listens on SIGINT too', async () => {
    const target = fakeProcess()

    installProcessHooks(fakeLogger().logger, { target })
    target.emit('SIGINT')
    await settle()

    expect(target.kill).toHaveBeenCalledWith(4242, 'SIGINT')
  })

  it('does not kill a process that is shutting itself down', async () => {
    const target = fakeProcess()
    const appHandler = vi.fn()
    target.on('SIGTERM', appHandler)
    const { logger, flush } = fakeLogger()

    installProcessHooks(logger, { target })
    target.emit('SIGTERM')
    await settle()

    expect(flush).toHaveBeenCalled()
    expect(appHandler).toHaveBeenCalled()
    expect(target.kill).not.toHaveBeenCalled()
  })

  it('takes a different list', async () => {
    const target = fakeProcess()

    installProcessHooks(fakeLogger().logger, { target, signals: ['SIGHUP'] })

    expect(target.listenerCount('SIGTERM')).toBe(0)
    target.emit('SIGHUP')
    await settle()
    expect(target.kill).toHaveBeenCalledWith(4242, 'SIGHUP')
  })
})

describe('beforeExit', () => {
  it('flushes once and gets out of the way', async () => {
    const target = fakeProcess()
    const { logger, flush } = fakeLogger()

    installProcessHooks(logger, { target, signals: false })
    target.emit('beforeExit', 0)
    target.emit('beforeExit', 0)
    await settle()

    expect(flush).toHaveBeenCalledTimes(1)
    expect(target.listenerCount('beforeExit')).toBe(0)
  })
})

describe('uninstall', () => {
  it('takes every listener back off', () => {
    const target = fakeProcess()

    const uninstall = installProcessHooks(fakeLogger().logger, { target })
    expect(target.listenerCount('uncaughtException')).toBe(1)
    expect(target.listenerCount('SIGTERM')).toBe(1)

    uninstall()

    for (const event of [
      'uncaughtException',
      'unhandledRejection',
      'beforeExit',
      'SIGTERM',
      'SIGINT',
    ]) {
      expect(target.listenerCount(event)).toBe(0)
    }
  })

  it('does nothing twice', () => {
    const target = fakeProcess()
    const uninstall = installProcessHooks(fakeLogger().logger, { target })

    uninstall()
    expect(() => uninstall()).not.toThrow()
  })

  it('is harmless where there is no process at all', () => {
    vi.stubGlobal('process', undefined)

    expect(() => installProcessHooks(fakeLogger().logger)()).not.toThrow()
  })
})
