import { Writable } from 'node:stream'
import type { AttributeInput, Logger, LogLevel } from '@nekolog-io/core'

export const SDK_NAME = '@nekolog-io/pino'
export const SDK_VERSION = '1.0.0'

export const MAX_LINE_BYTES: number = 1024 * 1024

export const PINO_OWN_FIELDS: readonly string[] = ['level', 'time', 'msg', 'err', 'v']

const THRESHOLDS: ReadonlyArray<readonly [number, LogLevel]> = [
  [60, 'fatal'],
  [50, 'error'],
  [40, 'warn'],
  [30, 'info'],
  [20, 'debug'],
]

export function levelOf(value: unknown): LogLevel {
  if (typeof value === 'string') {
    const named = value.toLowerCase()
    if (named === 'silent') {
      return 'trace'
    }
    const found = THRESHOLDS.find(([, level]) => level === named)
    return found === undefined ? (named === 'trace' ? 'trace' : 'info') : found[1]
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'info'
  }
  for (const [least, level] of THRESHOLDS) {
    if (value >= least) {
      return level
    }
  }
  return 'trace'
}

export type PinoLine = Record<string, unknown>

export function errorOf(line: PinoLine): Error | undefined {
  const raw = line.err
  if (typeof raw !== 'object' || raw === null) {
    return undefined
  }
  const { type, message, stack } = raw as { type?: unknown; message?: unknown; stack?: unknown }
  const error = new Error(typeof message === 'string' ? message : '')
  if (typeof type === 'string' && type !== '') {
    error.name = type
  }
  error.stack = typeof stack === 'string' ? stack : undefined
  return error
}

export function attributesOf(line: PinoLine, skip: readonly string[]): AttributeInput {
  const attributes: AttributeInput = {}
  for (const [key, value] of Object.entries(line)) {
    if (!skip.includes(key)) {
      attributes[key] = value
    }
  }
  return attributes
}

export type DestinationOptions = {
  skip?: readonly string[]
  onError?: (error: unknown) => void
}

export const MESSAGE_ATTRIBUTE = 'log.msg'

export function forward(logger: Logger, line: PinoLine, options: DestinationOptions = {}): void {
  const level = levelOf(line.level)
  const error = errorOf(line)
  const message = typeof line.msg === 'string' ? line.msg : undefined
  const attributes = attributesOf(line, options.skip ?? PINO_OWN_FIELDS)

  if (error === undefined) {
    logger.log(level, message ?? '', attributes)
    return
  }

  if (message !== undefined && message !== error.message) {
    attributes[MESSAGE_ATTRIBUTE] = message
  }
  logger.log(level, error, attributes)
}

export function nekologDestination(logger: Logger, options: DestinationOptions = {}): Writable {
  let pending = ''

  const take = (text: string): void => {
    if (text.trim() === '') {
      return
    }
    let line: PinoLine
    try {
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return
      }
      line = parsed as PinoLine
    } catch (error) {
      options.onError?.(error)
      return
    }
    try {
      forward(logger, line, options)
    } catch (error) {
      options.onError?.(error)
    }
  }

  return new Writable({
    write(chunk: Buffer | string, _encoding, done) {
      pending += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      if (pending.length > MAX_LINE_BYTES) {
        pending = ''
        options.onError?.(new Error('A pino line was longer than nekolog will buffer'))
        done()
        return
      }
      const parts = pending.split('\n')
      pending = parts.pop() ?? ''
      for (const part of parts) {
        take(part)
      }
      done()
    },
    final(done) {
      take(pending)
      pending = ''
      void logger.flush().then(
        () => done(),
        () => done(),
      )
    },
  })
}
